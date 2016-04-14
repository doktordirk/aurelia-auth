import {Container} from 'aurelia-dependency-injection';

import {Authentication} from '../src/authentication';
import {authorized} from '../src/authorized';

let container = new Container();
Container.instance = container;

class TestSubject {
  @authorized({message: 'foo'})
  withMessage() {
    return 'withMessage';
  }

  @authorized({error: 'bar'})
  withError() {
    return 'withError';
  }

  @authorized()
  withDefault() {
    return 'withDefault';
  }
}

describe( '@authorized(message:"some")', () => {
  it('execute if authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = {token: 'some'};

    let subject = new TestSubject();
    expect(subject.withMessage()).toBe('withMessage');
  });

  it('fail silent if not authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = null;

    let subject = new TestSubject();
    expect(subject.withMessage()).toBe(null);
  });
});

describe( '@authorized({error: "some"})', () => {
  it('execute if authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = {token: 'some'};

    let subject = new TestSubject();
    expect(subject.withError()).toBe('withError');
  });

  it('throw error if not authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = null;

    let subject = new TestSubject();
    let fail = () => subject.withError();
    expect(fail).toThrow();
  });
});

describe( '@authorized()', () => {
  it('execute if authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = {token: 'some'};

    let subject = new TestSubject();
    expect(subject.withDefault()).toBe('withDefault');
  });

  it('throw error if not authenticated', () => {
    let authentication = container.get(Authentication);
    authentication.responseObject = null;

    let subject = new TestSubject();
    let fail = () => subject.withDefault();
    expect(fail).toThrow();
  });
});
