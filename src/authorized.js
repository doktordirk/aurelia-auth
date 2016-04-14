import {Container} from 'aurelia-dependency-injection';
import {Authentication} from './authentication';
import * as LogManager from 'aurelia-logging';

/**
* Options that control how the authorized decorator should function at runtime.
*/
interface AuthorizedOptions {
  /**
  * Specifies a custom rejection message.
  */
  message: string;
  /**
  * Specifies whether or not a rejection should throw an error.
  */
  error: boolean;
}

/**
* Decorator: Enables marking methods as needed to be authorized.
* @param options: Options for how the authorized decorator should function at runtime.
*/
export function authorized(options?: AuthorizedOptions): any {
  return function(target, key, descriptor) {
    const methodSignature = `${target.constructor.name}#${key}`;
    let message = `Not authorized - ${methodSignature}`;
    options = options || {error: message};

    if (typeof descriptor.value !== 'function') {
      throw new SyntaxError('Only methods can be marked as needed to be authorized.');
    }

    if (options.message) {
      message += ` - ${options.message}`;
    }

    return {
      ...descriptor,
      value: function authorizedWrapper() {
        const isAuthenticated = Container.instance.get(Authentication).isAuthenticated();
        if (!isAuthenticated) {
          if (options.error) {
            throw new Error(message);
          } else {
            LogManager.getLogger('authentication').info(message);
          }
          return null;
        }

        return descriptor.value.apply(this, arguments);
      }
    };
  };
}
