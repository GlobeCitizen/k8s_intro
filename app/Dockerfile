FROM node:18-alpine as base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production

FROM base as test
RUN npm ci jest
COPY lib/ ./lib/
COPY test/ ./test/
ENTRYPOINT ["npm", "test"]
CMD ["npm", "test", "--", "--coverage"]

FROM base as app-base
ARG REDIS_URL=redis://episen-sca_cache:6379
ENV REDIS_URL=${REDIS_URL}
EXPOSE 1337

FROM app-base as dev
RUN npm ci node-dev
VOLUME /app/lib
EXPOSE 9229
ENTRYPOINT ["npm", "run", "dev:poll"]
CMD ["npm", "run", "dev:poll"]

FROM app-base
COPY lib/ ./lib/
CMD ["npm", "start"]
