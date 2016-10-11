/* eslint-disable max-lines */
import {PLATFORM} from 'aurelia-pal';
import {inject} from 'aurelia-dependency-injection';
import {deprecated} from 'aurelia-metadata';
import {EventAggregator} from 'aurelia-event-aggregator';
import {BindingSignaler} from 'aurelia-templating-resources';
import * as LogManager from 'aurelia-logging';
import {Authentication} from './authentication';
import {BaseConfig} from './baseConfig';

@inject(Authentication, BaseConfig, BindingSignaler, EventAggregator)
export class AuthService {
  /**
   * The Authentication instance that handles the token
   *
   * @param  {Authentication}
   */
  authentication: Authentication;

  /**
   * The Config instance that contains the current configuration setting
   *
   * @param  {Config}
   */
  config: Config;

  /**
   * The current login status
   *
   * @param  {Boolean}
   */
  authenticated: Boolean  = false;

  /**
   * The currently set timeoutID
   *
   * @param  {Number}
   */
  timeoutID: Number = 0;

  /**
   *  Create an AuthService instance
   *
   * @param  {Authentication}  authentication  The Authentication instance to be used
   * @param  {Config}          config          The Config instance to be used
   * @param  {BindingSignaler} bindingSignaler The BindingSignaler instance to be used
   * @param  {EventAggregator} eventAggregator The EventAggregator instance to be used
   */
  constructor(authentication: Authentication, config: BaseConfig, bindingSignaler: BindingSignaler, eventAggregator: EventAggregator) {
    this.authentication  = authentication;
    this.config          = config;
    this.bindingSignaler = bindingSignaler;
    this.eventAggregator = eventAggregator;

    // get token stored in previous format over
    const oldStorageKey = config.tokenPrefix
                        ? `${config.tokenPrefix}_${config.tokenName}`
                        : config.tokenName;
    const oldToken = authentication.storage.get(oldStorageKey);

    if (oldToken) {
      LogManager.getLogger('authentication').info('Found token with deprecated format in storage. Converting it to new format. No further action required.');
      let fakeOldResponse = {};

      fakeOldResponse[config.accessTokenProp] = oldToken;
      this.setResponseObject(fakeOldResponse);
      authentication.storage.remove(oldStorageKey);
    }

    // initialize status by resetting if existing stored responseObject
    this.setResponseObject(this.authentication.getResponseObject());

    // listen to storage events in case the user logs in or out in another tab/window
    PLATFORM.addEventListener('storage', this.storageEventHandler);
  }

  /**
   * The handler used for storage events. Detects and handles authentication changes in other tabs/windows
   *
   * @param {StorageEvent} event StorageEvent
   */
  storageEventHandler = (event: StorageEvent) => {
    if (event.key !== this.config.storageKey || event.newValue === event.oldValue) {
      return;
    }

    LogManager.getLogger('authentication').info('Stored token changed event');

    // IE runs the event handler before updating the storage value. Update it now.
    // An unset storage key in IE is an empty string, where-as chrome is null
    if (event.newValue) {
      this.authentication.storage.set(this.config.storageKey, event.newValue);
    } else {
      this.authentication.storage.remove(this.config.storageKey);
    }

    let wasAuthenticated = this.authenticated;

    this.authentication.responseAnalyzed = false;
    this.updateAuthenticated();

    if (wasAuthenticated === this.authenticated) {
      return;
    }

    if (this.config.storageChangedRedirect) {
      PLATFORM.location.href = this.config.storageChangedRedirect;
    }
    PLATFORM.location.reload();
  }

  /**
   * Getter: The configured client for all aurelia-authentication requests
   *
   * @return {HttpClient}
   */
  get client(): HttpClient {
    return this.config.client;
  }

  /**
   * Getter: The authentication class instance
   *
   * @return {boolean}
   * @deprecated
   */
  get auth(): Authentication {
    LogManager.getLogger('authentication').warn('AuthService.auth is deprecated. Use .authentication instead.');

    return this.authentication;
  }

  /**
   * Sets the login timeout
   *
   * @param  {Number} ttl  Timeout time in ms
   */
  setTimeout(ttl: Number) {
    this.clearTimeout();

    this.timeoutID = PLATFORM.global.setTimeout(() => {
      if (this.config.autoUpdateToken
        && this.authentication.getAccessToken()
        && this.authentication.getRefreshToken()) {
        this.updateToken();

        return;
      }

      this.setResponseObject(null);

      if (this.config.expiredRedirect) {
        PLATFORM.location.assign(this.config.expiredRedirect);
      }
    }, ttl);
  }

  /**
   * Clears the login timeout
   */
  clearTimeout() {
    if (this.timeoutID) {
      PLATFORM.global.clearTimeout(this.timeoutID);
    }
    this.timeoutID = 0;
  }

  /**
   * Stores and analyses the servers responseObject. Sets login status and timeout
   *
   * @param {{}} response The servers response as object
   */
  setResponseObject(response: {}) {
    this.authentication.setResponseObject(response);

    this.updateAuthenticated();
  }

  /**
   * Update authenticated. Sets login status and timeout
   */
  updateAuthenticated() {
    this.clearTimeout();

    let wasAuthenticated = this.authenticated;

    this.authenticated = this.authentication.isAuthenticated();

    if (this.authenticated && !Number.isNaN(this.authentication.exp)) {
      this.setTimeout(this.getTtl() * 1000);
    }

    if (wasAuthenticated !== this.authenticated) {
      this.bindingSignaler.signal('authentication-change');
      this.eventAggregator.publish('authentication-change', this.authenticated);

      LogManager.getLogger('authentication').info(`Authorization changed to: ${this.authenticated}`);
    }
  }

  /**
   * Get current user profile from server
   *
   * @param {({}|Number|String)} [criteriaOrId] (optional) An object or a Number|String converted to {id: criteriaOrId}
   * @returns {Promise<any>} The server response
   *
   * @memberOf AuthService
   */
  getMe(criteriaOrId?: {}|Number|String): Promise<any> {
    if (typeof criteriaOrId === 'string' || typeof criteriaOrId === 'number') {
      criteriaOrId = {id: criteriaOrId};
    }

    return this.client.find(this.config.joinBase(this.config.profileUrl), criteriaOrId);
  }

  /**
   * Send current user profile update to server
   *
   * @param {{}}                body           Request body with data.
   * @param {{}|Number|String}  [criteriaOrId] (optional) An object or a Number|String converted to {id: criteriaOrId}
   *
   * @return {Promise<any>} The server response
   */
  updateMe(body: {}, criteriaOrId?: {}|Number|String): Promise<any> {
    if (typeof criteriaOrId === 'string' || typeof criteriaOrId === 'number') {
      criteriaOrId = {id: criteriaOrId};
    }
    if (this.config.profileMethod === 'put') {
      return this.client.update(this.config.joinBase(this.config.profileUrl), criteriaOrId, body);
    }

    return this.client.patch(this.config.joinBase(this.config.profileUrl), criteriaOrId, body);
  }

  /**
   * Get accessToken from storage
   *
   * @returns {String} Current accessToken
   */
  getAccessToken(): String {
    return this.authentication.getAccessToken();
  }

  @deprecated({message: 'Use .getAccessToken() instead.'})
  getCurrentToken(): String {
    return this.getAccessToken();
  }

  /**
   * Get refreshToken from storage
   *
   * @returns {String} Current refreshToken
   */
  getRefreshToken(): String {
    return this.authentication.getRefreshToken();
  }

  /**
   * Get idToken from storage
   *
   * @returns {String} Current idToken
   */
  getIdToken(): String {
    return this.authentication.getIdToken();
  }

 /**
  * Gets authentication status from storage
  *
  * @returns {Boolean} For Non-JWT and unexpired JWT: true, else: false
  */
  isAuthenticated(): Boolean {
    this.authentication.responseAnalyzed = false;

    let authenticated = this.authentication.isAuthenticated();

    // auto-update token?
    if (!authenticated
      && this.config.autoUpdateToken
      && this.authentication.getAccessToken()
      && this.authentication.getRefreshToken()
    ) {
      this.updateToken();
      authenticated = true;
    }

    return authenticated;
  }

  /**
   * Gets exp in milliseconds
   *
   * @returns {Number} Exp for JWT tokens, NaN for all other tokens
   */
  getExp(): Number {
    return this.authentication.getExp();
  }

  /**
   * Gets ttl in seconds
   *
   * @returns {Number} Ttl for JWT tokens, NaN for all other tokens
   */
  getTtl(): Number {
    return this.authentication.getTtl();
  }

 /**
  * Gets exp from token payload and compares to current time
  *
  * @returns {Boolean} Returns (ttl > 0)? for JWT, undefined other tokens
  */
  isTokenExpired(): Boolean {
    return this.authentication.isTokenExpired();
  }

  /**
  * Get payload from tokens
  *
  * @returns {{}} Payload for JWT, else null
  */
  getTokenPayload(): {} {
    return this.authentication.getPayload();
  }

  /**
   * Request new access token
   *
   * @returns {Promise<any>} Requests new token. can be called multiple times
   */
  updateToken(): Promise<any> {
    if (!this.authentication.getRefreshToken()) {
      return Promise.reject(new Error('refreshToken not set'));
    }

    if (this.authentication.updateTokenCallstack.length === 0) {
      let content = {
        grant_type: 'refresh_token',
        client_id : this.config.clientId ? this.config.clientId : undefined
      };

      content[this.config.refreshTokenSubmitProp] = this.authentication.getRefreshToken();

      this.client.post(this.config.joinBase(this.config.refreshTokenUrl
                                            ? this.config.refreshTokenUrl
                                            : this.config.loginUrl), content)
        .then(response => {
          this.setResponseObject(response);
          this.authentication.resolveUpdateTokenCallstack(this.isAuthenticated());
        })
        .catch(err => {
          this.setResponseObject(null);
          this.authentication.resolveUpdateTokenCallstack(Promise.reject(err));
        });
    }

    return this.authentication.toUpdateTokenCallstack();
  }

  /**
   * Signup locally. Login and redirect depending on config
   *
   * @param {String|{}}   displayNameOrCredentials displayName | object with signup data.
   * @param {[String]|{}} emailOrOptions           [email | options for post request]
   * @param {[String]}    passwordOrRedirectUri    [password | optional redirectUri overwrite]
   * @param {[{}]}        options                  [options]
   * @param {[String]}    redirectUri              [optional redirectUri overwrite]
   *
   * @return {Promise<any>} Server response as Object
   */
  signup(displayNameOrCredentials: String|{}, emailOrOptions?: String|{}, passwordOrRedirectUri?: String, options?: {}, redirectUri?: String): Promise<any> {
    let normalized = {};

    if (typeof displayNameOrCredentials === 'object') {
      normalized.credentials = displayNameOrCredentials;
      normalized.options     = emailOrOptions;
      normalized.redirectUri = passwordOrRedirectUri;
    } else {
      normalized.credentials = {
        'displayName': displayNameOrCredentials,
        'email'      : emailOrOptions,
        'password'   : passwordOrRedirectUri
      };
      normalized.options     = options;
      normalized.redirectUri = redirectUri;
    }

    return this.client.post(this.config.joinBase(this.config.signupUrl), normalized.credentials, normalized.options)
      .then(response => {
        if (this.config.loginOnSignup) {
          this.setResponseObject(response);
        }
        this.authentication.redirect(normalized.redirectUri, this.config.signupRedirect);

        return response;
      });
  }

  /**
   * Login locally. Redirect depending on config
   *
   * @param {[String]|{}} emailOrCredentials      email | object with signup data.
   * @param {[String]}    [passwordOrOptions]     [password | options for post request]
   * @param {[{}]}        [optionsOrRedirectUri]  [options | redirectUri overwrite]]
   * @param {[String]}    [redirectUri]           [optional redirectUri overwrite]
   *
   * @return {Promise<Object>|Promise<Error>}    Server response as Object
   */
  login(emailOrCredentials: String|{}, passwordOrOptions?: String, optionsOrRedirectUri?: {}, redirectUri?: String): Promise<any> {
    let normalized = {};

    if (typeof emailOrCredentials === 'object') {
      normalized.credentials = emailOrCredentials;
      normalized.options     = passwordOrOptions;
      normalized.redirectUri = optionsOrRedirectUri;
    } else {
      normalized.credentials = {
        'email'   : emailOrCredentials,
        'password': passwordOrOptions
      };
      normalized.options     = optionsOrRedirectUri;
      normalized.redirectUri = redirectUri;
    }

    if (this.config.clientId) {
      normalized.credentials.client_id = this.config.clientId;
    }

    return this.client.post(this.config.joinBase(this.config.loginUrl), normalized.credentials, normalized.options)
      .then(response => {
        this.setResponseObject(response);

        this.authentication.redirect(normalized.redirectUri, this.config.loginRedirect);

        return response;
      });
  }

  /**
   * Logout locally and redirect to redirectUri (if set) or redirectUri of config. Sends logout request first, if set in config
   *
   * @param {[String]}    [redirectUri]                     [optional redirectUri overwrite]
   * @param {[String]}    [query]                           [optional query]
   * @param {[String]}    [name]                            [optional name Name of the provider]
   *
   * @return {Promise<any>}     Server response as Object
   */
  logout(redirectUri?: String, query?: String, name?: String): Promise<any> {
    let localLogout = response => new Promise(resolve => {
      this.setResponseObject(null);

      this.authentication.redirect(redirectUri, this.config.logoutRedirect, query);

      if (typeof this.onLogout === 'function') {
        this.onLogout(response);
      }
      resolve(response);
    });

    if (name) {
      if (this.config.providers[name].logoutEndpoint) {
        return this.authentication.logout(name)
          .then(logoutResponse => {
            let stateValue = this.authentication.storage.get(name + '_state');

            if (logoutResponse.state !== stateValue) {
              return Promise.reject('OAuth2 response state value differs');
            }

            return localLogout(logoutResponse);
          });
      }
    } else {
      return this.config.logoutUrl
        ? this.client.request(this.config.logoutMethod, this.config.joinBase(this.config.logoutUrl)).then(localLogout)
        : localLogout();
    }
  }

  /**
   * Authenticate with third-party and redirect to redirectUri (if set) or redirectUri of config
   *
   * @param {String}    name          Name of the provider
   * @param {[String]}  [redirectUri] [optional redirectUri overwrite]
   * @param {[{}]}      [userData]    [optional userData for the local authentication server]
   *
   * @return {Promise<any>} Server response as Object
   */
  authenticate(name: String, redirectUri?: String, userData?: {}): Promise<any> {
    return this.authentication.authenticate(name, userData)
      .then(response => {
        this.setResponseObject(response);

        this.authentication.redirect(redirectUri, this.config.loginRedirect);

        return response;
      });
  }

  /**
   * Unlink third-party
   *
   * @param {String}    name          Name of the provider
   * @param {[String]}  [redirectUri] [optional redirectUri overwrite]
   *
   * @return {Promise<any>}  Server response as Object
   */
  unlink(name: String, redirectUri?: String): Promise<any> {
    const unlinkUrl = this.config.joinBase(this.config.unlinkUrl) + name;

    return this.client.request(this.config.unlinkMethod, unlinkUrl)
      .then(response => {
        this.authentication.redirect(redirectUri);

        return response;
      });
  }
}
