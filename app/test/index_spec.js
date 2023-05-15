const http = require('node:http');

const redis = require('redis');

const api = require('../lib');

//#region Main functions

describe('bootstrap', () => {
  // GIVEN
  /** @type {NodeJS.Process} */
  let proc;
  /** @type {redis.RedisClientType} */
  let redisClient;
  /** @type {http.Server} */
  let server;

  beforeEach(() => {
    proc = {
      env: {
        SERVER_PORT: 1337,
      },
      exit: jest.fn(),
    };
    redisClient = {
      connect: jest.fn(),
      on: jest.fn(),
    };
    server = {
      listen: jest.fn(),
    };

    jest.spyOn(redis, 'createClient').mockImplementation(() => redisClient);
    jest.spyOn(http, 'createServer').mockImplementation(() => server);
  });

  it('should create app config and call main', () => {
    // GIVEN
    // WHEN
    api.bootstrap(proc);

    // THEN
    expect(server.listen).toBeCalledWith(1337, expect.any(Function));
  });

  it('should exit when an error occured', () => {
    // GIVEN
    const err = new Error('fake error');

    jest.spyOn(http, 'createServer').mockImplementationOnce(() => { throw err; });

    // WHEN
    api.bootstrap(proc);

    // THEN
    expect(proc.exit).toBeCalledWith(99);
    expect(server.listen).not.toBeCalled();
  });
});

describe('createAppConfigFromEnv', () => {
  it('should create app config from environment variables', () => {
    // GIVEN
    /** @type {NodeJS.ProcessEnv} */
    const processEnv = {
      REDIS_DATABASE: 1,
      REDIS_PASSWORD: 'redis_password',
      REDIS_SOCKET_CONNECT_TIMEOUT: 1_000,
      REDIS_SOCKET_FAMILY: 4,
      REDIS_SOCKET_HOST: '127.0.0.1',
      REDIS_SOCKET_KEEP_ALIVE: 2_000,
      REDIS_SOCKET_NO_DELAY: 'true',
      REDIS_SOCKET_PATH: '/path/to/the/unix/socket',
      REDIS_SOCKET_PORT: 6380,
      REDIS_SOCKET_RECONNECT_WAITING_TIME: 3_000,
      REDIS_USERNAME: 'redis_username',
      REDIS_URL: 'redis://redis_username:redis_password@127.0.0.1:6380/1',
      SERVER_PORT: 1338,
    };

    // WHEN
    // THEN
    expect(api.createAppConfigFromEnv(processEnv)).toEqual({
      httpServer: {
        port: 1338,
      },
      redis: {
        database: 1,
        password: 'redis_password',
        socket: {
          connectTimeout: 1_000,
          family: 4,
          host: '127.0.0.1',
          keepAlive: 2_000,
          noDelay: true,
          path: '/path/to/the/unix/socket',
          port: 6380,
          reconnectStrategy: 3_000,
        },
        username: 'redis_username',
        url: 'redis://redis_username:redis_password@127.0.0.1:6380/1',
      },
    });
  });
});

describe('createRedisClient', () => {
  it('should create redis client', () => {
    // GIVEN
    /** @type {redis.RedisClientOptions} */
    const options = { url: 'redis://127.0.0.1:6379' };
    const redisClient = { on: jest.fn() };

    jest.spyOn(redis, 'createClient').mockReturnValueOnce(redisClient);

    // WHEN
    const db = api.createRedisClient(options);

    // THEN
    expect(db).toBe(redisClient);
    expect(db.on).toBeCalledWith('connect', expect.any(Function));
    expect(db.on).toBeCalledWith('disconnect', expect.any(Function));
    expect(db.on).toBeCalledWith('error', expect.any(Function));
  });
});

describe('createRequestListener', () => {
  /** @type {redis.RedisClientType} */
  let db;
  /** @type {http.IncomingMessage} */
  let req;
  /** @type {function} */
  let reqOnData;
  /** @type {function} */
  let reqOnEnd;
  /** @type {function} */
  let reqOnError;
  /** @type {http.ServerResponse} */
  let res;
  /** @type {http.RequestListener} */
  let requestListener;

  beforeEach(() => {
    db = {
      isReady: true,
      isOpen: true,
      del: jest.fn(),
      exists: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
    };
    req = {
      method: 'GET',
      url: '/',
      on: jest.fn((eventName, eventListener) => {
        switch (eventName) {
          case 'data':
            reqOnData = eventListener;
            break;
          case 'end':
            reqOnEnd = eventListener;
            break;
          case 'error':
            reqOnError = eventListener;
            break;
        }
      }),
    };
    res = { end: jest.fn() };

    requestListener = api.createRequestListener(db);
  });

  it('should delete page content in db', async () => {
    // GIVEN
    req.method = 'DELETE';
    req.url = '/foo';

    // WHEN
    await requestListener(req, res);

    // THEN
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalled();
    expect(db.del).toBeCalledWith('/foo');
  });

  it('should get page content in db', async () => {
    // GIVEN
    req.method = 'GET';
    req.url = '/foo';

    jest.spyOn(db, 'exists').mockResolvedValueOnce(1);
    jest.spyOn(db, 'get').mockResolvedValueOnce('bar');

    // WHEN
    await requestListener(req, res);

    // THEN
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalledWith('bar');
    expect(db.exists).toBeCalledWith('/foo');
    expect(db.get).toBeCalledWith('/foo');
  });

  it('should set page content in db', async () => {
    // GIVEN
    req.method = 'POST';
    req.url = '/foo';

    // WHEN
    const processingPromise = requestListener(req, res);

    reqOnData(Buffer.from('bar', 'utf8'));
    reqOnEnd();

    await processingPromise;

    // THEN
    expect(res.statusCode).toBe(201);
    expect(res.end).toBeCalled();
    expect(db.set).toBeCalledWith('/foo', Buffer.from('bar', 'utf8'));
  });

  it('should send status 404 when content is not in db', async () => {
    // GIVEN
    req.method = 'GET';
    req.url = '/foo';

    jest.spyOn(db, 'exists').mockResolvedValueOnce(0);

    // WHEN
    await requestListener(req, res);

    // THEN
    expect(res.statusCode).toBe(404);
    expect(res.end).toBeCalled();
    expect(db.exists).toBeCalledWith('/foo');
    expect(db.get).not.toBeCalled();
  });

  it('should send status 502 when db is not connected', async () => {
    // GIVEN
    req.method = 'GET';
    req.url = '/foo';
    db.isReady = false;

    // WHEN
    await requestListener(req, res);

    // THEN
    expect(res.statusCode).toBe(502);
    expect(db.exists).not.toBeCalled();
    expect(db.get).not.toBeCalled();
  });

  it('should send status 500 when db error occurred', async () => {
    // GIVEN
    req.method = 'GET';
    req.url = '/foo';

    const err = new Error('fake error');

    jest.spyOn(db, 'exists').mockRejectedValueOnce(err);

    // WHEN
    await requestListener(req, res);

    // THEN
    expect(res.statusCode).toBe(500);
    expect(db.exists).toBeCalled();
    expect(db.get).not.toBeCalled();
  });
});

//#endregion

//#region App request handlers

describe('handle404NotFound', () => {
  it('should send status 404', () => {
    // GIVEN
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    api.handle404NotFound({ res });

    // THEN
    expect(res.statusCode).toBe(404);
    expect(res.end).toBeCalled();
  });
});

describe('handleDeletePage', () => {
  it('should delete req.url in db', async () => {
    // GIVEN
    /** @type {redis.RedisClientType} */
    const db = { del: jest.fn() };
    /** @type {http.IncomingMessage} */
    const req = { url: '/foo' };
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    await api.handleDeletePage({ db, req, res });

    // THEN
    expect(db.del).toBeCalledWith('/foo');
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalled();
  });
});

describe('handleGetPage', () => {
  it('should get req.url in db', async () => {
    // GIVEN
    /** @type {redis.RedisClientType} */
    const db = {
      exists: jest.fn().mockResolvedValueOnce(1),
      get: jest.fn().mockResolvedValueOnce('bar'),
    };
    /** @type {http.IncomingMessage} */
    const req = { url: '/foo' };
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    await api.handleGetPage({ db, req, res });

    // THEN
    expect(db.exists).toBeCalledWith('/foo');
    expect(db.get).toBeCalledWith('/foo');
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalledWith('bar');
  });
});

describe('handleSetPage', () => {
  it('should set req.url in db', async () => {
    // GIVEN
    /** @type {redis.RedisClientType} */
    const db = { set: jest.fn() };
    /** @type {function} */
    let reqOnData;
    /** @type {function} */
    let reqOnEnd;
    /** @type {http.IncomingMessage} */
    const req = {
      url: '/foo',
      on: jest.fn((eventName, eventListener) => {
        switch (eventName) {
          case 'data':
            reqOnData = eventListener;
            break;
          case 'end':
            reqOnEnd = eventListener;
            break;
        }
      }),
    };
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    const processingPromise = api.handleSetPage({ db, req, res });

    reqOnData(Buffer.from('bar', 'utf8'));
    reqOnEnd();

    await processingPromise;

    // THEN
    expect(db.set).toBeCalledWith('/foo', Buffer.from('bar', 'utf8'));
    expect(res.statusCode).toBe(201);
    expect(res.end).toBeCalled();
  });
});

//#endregion

//#region Utils

describe('getDataFromRequest', () => {
  /** @type {http.IncomingMessage} */
  let req;
  /** @type {function} */
  let reqOnData;
  /** @type {function} */
  let reqOnEnd;
  /** @type {function} */
  let reqOnError;

  beforeEach(() => {
    req = {
      on: jest.fn((eventName, eventListener) => {
        switch (eventName) {
          case 'data':
            reqOnData = eventListener;
            break;
          case 'end':
            reqOnEnd = eventListener;
            break;
          case 'error':
            reqOnError = eventListener;
            break;
        }
      }),
    };
  });

  it('should listen on request events', () => {
    // GIVEN
    // WHEN
    api.getDataFromRequest(req);

    // THEN
    expect(req.on).toBeCalledWith('data', reqOnData);
    expect(req.on).toBeCalledWith('end', reqOnEnd);
    expect(req.on).toBeCalledWith('error', reqOnError);
  });

  it('should resolve data', async () => {
    // GIVEN
    const fooBuffer = Buffer.from('foo', 'utf8');
    const barBuffer = Buffer.from('bar', 'utf8');
    const foobarBuffer = Buffer.concat([fooBuffer, barBuffer]);
    
    // WHEN
    const reqDataPromise = api.getDataFromRequest(req);

    reqOnData(fooBuffer);
    reqOnData(barBuffer);
    reqOnEnd();

    // THEN
    await expect(reqDataPromise).resolves.toEqual(foobarBuffer);
  });

  it('should reject error', async () => {
    // GIVEN
    const err = new Error('fake error');
    
    // WHEN
    const reqDataPromise = api.getDataFromRequest(req);

    reqOnError(err);

    // THEN
    await expect(reqDataPromise).rejects.toBe(err);
  });
});

describe('isRedisConnected', () => {
  it.each([
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [true, true, true],
  ])('should return %s when isOpen=%s and isReady=%s', (resultExpected, redisIsOpen, redisIsReady) => {
    // GIVEN
    /** @type {redis.RedisClientType} */
    const redis = {
      isOpen: redisIsOpen,
      isReady: redisIsReady,
    };

    // WHEN
    // THEN
    expect(api.isRedisConnected(redis)).toBe(resultExpected);
  });
});

describe('sendHttpStatus', () => {
  it('should send given http status', () => {
    // GIVEN
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    api.sendHttpStatus(res, 200);

    // THEN
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalledWith(http.STATUS_CODES[200]);
  });

  it('should send given http status and message', () => {
    // GIVEN
    /** @type {http.ServerResponse} */
    const res = { end: jest.fn() };

    // WHEN
    api.sendHttpStatus(res, 200, 'foobar');

    // THEN
    expect(res.statusCode).toBe(200);
    expect(res.end).toBeCalledWith('foobar');
  });
});

//#endregion
