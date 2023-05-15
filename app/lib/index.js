const http = require('node:http');

const redis = require('redis');

//#region Type definitions

/**
 * @typedef {Object} AppConfig
 * @prop {AppConfigHttpServer} httpServer
 * @prop {AppConfigRedis} redis
 */

/**
 * @typedef {redis.RedisClientOptions} AppConfigRedis
 */

/**
 * @typedef {Object} AppConfigHttpServer
 * @prop {number} port
 */

/**
 * @typedef {Object} AppRequestHandlerContext
 * @prop {redis.RedisClientType} db
 * @prop {typeof http.IncomingMessage} req
 * @prop {typeof http.ServerResponse} res
 */

/**
 * An application request handler.
 * @typedef {(context: AppRequestHandlerContext) => void | Promise<void>} AppRequestHandler
 */

//#endregion

//#region Main functions

/**
 * Bootstrap application.
 * @param {NodeJS.Process} proc
 * @returns {Promise<void>}
 */
function bootstrap(proc) {
  try {
    const appConfig = createAppConfigFromEnv(proc.env);

    main(appConfig);
  } catch (err) {
    console.error('ERROR | An error occured during bootstrap:', err);

    proc.exit(99);
  }
}
exports.bootstrap = bootstrap;

/**
 * Create application and run it on http server.
 * @param {AppConfig} appConfig
 * @returns {void}
 */
function main(appConfig) {
  const {
    httpServer: httpServerOptions,
    redis: redisOptions,
  } = appConfig;

  const db = createRedisClient(redisOptions);
  const requestListener = createRequestListener(db);
  const server = http.createServer(requestListener);

  db.connect();

  server.listen(
    httpServerOptions.port,
    /* istanbul ignore next */
    () => console.info(`INFO  | Server listening on http://localhost:${httpServerOptions.port}`),
  );
}
exports.main = main;

/**
 * Create app config from environment variables.
 * @param {NodeJS.ProcessEnv} env
 * @returns {AppConfig}
 */
function createAppConfigFromEnv(env) {
  return {
    httpServer: {
      port: +env.SERVER_PORT || 1337,
    },
    redis: {
      database: +env.REDIS_DATABASE || 0,
      password: env.REDIS_PASSWORD,
      socket: {
        connectTimeout: +env.REDIS_SOCKET_CONNECT_TIMEOUT || 5_000,
        family: +env.REDIS_SOCKET_FAMILY || 0,
        host: env.REDIS_SOCKET_HOST,
        keepAlive: +env.REDIS_SOCKET_KEEP_ALIVE || 5_000,
        noDelay: ['true', '1'].includes(env.REDIS_SOCKET_NO_DELAY),
        path: env.REDIS_SOCKET_PATH,
        port: env.REDIS_SOCKET_PORT,
        reconnectStrategy: +env.REDIS_SOCKET_RECONNECT_WAITING_TIME || 5_000,
      },
      username: env.REDIS_USERNAME,
      url: env.REDIS_URL,
    },
  };
}
exports.createAppConfigFromEnv = createAppConfigFromEnv;

/**
 * Create redis client.
 * @param {redis.RedisClientOptions} options
 * @returns {Promise<redis.RedisClientType>}
 */
function createRedisClient(options) {
  const client = redis.createClient(options);

  client.on('connect', () => console.info('INFO  | RedisClient: Connected'));
  client.on('disconnect', () => console.info('INFO  | RedisClient: Disconnected'));
  client.on('error', err => console.error('ERROR | RedisClient:', err));

  return client;
}
exports.createRedisClient = createRedisClient;

/**
 * Create request listener.
 * @param {redis.RedisClientType} db
 * @returns {http.RequestListener}
 */
function createRequestListener(db) {
  return async (req, res) => {
    const { method, url } = req;
    /** @type {AppRequestHandler} */
    let requestHandler = handle404NotFound;
    let requestHandlerNeedsDb = false;

    switch (method) {
      case 'GET':
      case 'HEAD':
        requestHandler = handleGetPage;
        requestHandlerNeedsDb = true;
        break;
      case 'POST':
      case 'PUT':
        requestHandler = handleSetPage;
        requestHandlerNeedsDb = true;
        break;
      case 'DELETE':
        requestHandler = handleDeletePage;
        requestHandlerNeedsDb = true;
        break;
    }

    try {
      console.info(`INFO  | ${method} ${url} - Incoming request processing...`);

      if (requestHandlerNeedsDb && !isRedisConnected(db)) {
        console.warn('WARN  | Request handler needs database but this last one is not connected');

        sendHttpStatus(res, 502);
      } else {
        /** @type {AppRequestHandlerContext} */
        const context = { db: db, req, res };

        await requestHandler(context);
      }

      console.info(`INFO  | ${method} ${url} - Incoming request processed with status code ${res.statusCode}`);
    } catch (err) {
      console.error('ERROR | An error occured during request handling:', err);

      sendHttpStatus(res, 500);
    }
  };
}
exports.createRequestListener = createRequestListener;

//#endregion

//#region App request handlers

/**
 *
 * @param {AppRequestHandlerContext} requestHandlerContext
 * @returns {Promise<void>}
 */
function handle404NotFound({ res }) {
  sendHttpStatus(res, 404);
}
exports.handle404NotFound = handle404NotFound;

/**
 *
 * @param {AppRequestHandlerContext} requestHandlerContext
 * @returns {Promise<void>}
 */
async function handleDeletePage({ db, req, res }) {
  const keyInDb = req.url;

  console.info(`INFO  | Del key "${keyInDb}"`);

  await db.del(keyInDb);

  sendHttpStatus(res, 200);
}
exports.handleDeletePage = handleDeletePage;

/**
 *
 * @param {AppRequestHandlerContext} requestHandlerContext
 * @returns {Promise<void>}
 */
async function handleGetPage({ db, req, res }) {
  const keyInDb = req.url;

  console.info(`INFO  | Get key "${keyInDb}"`);

  const keyNumberThatExistInDb = await db.exists(keyInDb);
  const keyExistsInDb = keyNumberThatExistInDb == 1;

  if (!keyExistsInDb) {
    sendHttpStatus(res, 404);
  } else {
    const data = await db.get(keyInDb);

    sendHttpStatus(res, 200, data);
  }
}
exports.handleGetPage = handleGetPage;

/**
 *
 * @param {AppRequestHandlerContext} requestHandlerContext
 * @returns {Promise<void>}
 */
async function handleSetPage({ db, req, res }) {
  const keyInDb = req.url;

  console.info(`INFO  | Set key "${keyInDb}"`);

  const data = await getDataFromRequest(req);

  await db.set(keyInDb, data);

  sendHttpStatus(res, 201);
}
exports.handleSetPage = handleSetPage;

//#endregion

//#region Utils

/**
 * Create promise which resolves request post data.
 * @param {typeof http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function getDataFromRequest(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
exports.getDataFromRequest = getDataFromRequest;

/**
 * Returns `true` when redis client is connected.
 * @param {redis.RedisClientType} redisClient
 * @returns {boolean}
 */
function isRedisConnected(redisClient) {
  return !!(redisClient.isOpen && redisClient.isReady);
}
exports.isRedisConnected = isRedisConnected;

/**
 *
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {string | undefined} message
 * @returns {void}
 */
function sendHttpStatus(res, statusCode, message) {
  res.statusCode = statusCode;
  res.end(message || http.STATUS_CODES[statusCode]);
}
exports.sendHttpStatus = sendHttpStatus;

//#endregion
