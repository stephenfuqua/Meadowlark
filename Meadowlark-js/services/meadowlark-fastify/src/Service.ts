// SPDX-License-Identifier: Apache-2.0
// Licensed to the Ed-Fi Alliance under one or more agreements.
// The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
// See the LICENSE and NOTICES files in the project root for more information.

/* eslint-disable no-use-before-define */
// Disable no-floating-promises because Fastify has a multi-async style and we aren't using the one eslint is flagging
/* eslint-disable @typescript-eslint/no-floating-promises */

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import FastifyRateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyLoggerInstance } from 'fastify';
import { Config, Logger } from '@edfi/meadowlark-utilities';
import { deleteIt, get, update, upsert } from './handler/CrudHandler';
import { closeMeadowlarkConnection } from './handler/MeadowlarkConnection';
import {
  apiVersion,
  swaggerForResourcesAPI,
  swaggerForDescriptorsAPI,
  openApiUrlList,
  dependencies,
  xsdMetadata,
} from './handler/MetadataHandler';
import { loadDescriptors } from './handler/DescriptorLoader';
import {
  createAuthorizationClientHandler,
  requestTokenAuthorizationHandler,
  resetAuthorizationClientSecretHandler,
  updateAuthorizationClientHandler,
  verifyTokenAuthorizationHandler,
  createSigningKeyHandler,
  getClientByIdHandler,
  getClientsHandler,
} from './handler/authorization/AuthorizationHandler';

export function buildService(): FastifyInstance {
  const service = createFastifyService();
  customizeRequestLogging(service);
  alwaysRespondAsJson(service);
  setupRateLimiting(service);
  configureAcceptedContentTypes(service);
  configureRouting(service);

  return service;

  function createFastifyService(): FastifyInstance {
    return Fastify({
      logger: Logger as FastifyLoggerInstance,
      disableRequestLogging: true,
      genReqId: () => randomUUID(),
    });
  }

  function customizeRequestLogging(fastify: FastifyInstance): void {
    // Customize the request logging so that request Id and extra info can be passed into the Meadowlark logger.
    function now() {
      return Date.now();
    }

    fastify.addHook('onRequest', (req, reply, done) => {
      // eslint-disable-next-line dot-notation
      reply.headers['startTime'] = now();
      Logger.info('Request', req.id, { url: req.raw.url, contentType: req.headers['content-type'], method: req.method });
      done();
    });

    fastify.addHook('onResponse', (req, reply, done) => {
      Logger.info('Response', req.id, {
        url: req.raw.url,
        statusCode: reply.raw.statusCode,
        // eslint-disable-next-line dot-notation
        durationMs: now() - Number(reply.headers['startTime']),
      });
      done();
    });

    fastify.addHook('onClose', (_instance, done) => {
      Logger.info('Close signal received', null);
      closeMeadowlarkConnection();
      done();
    });
  }

  function alwaysRespondAsJson(fastify: FastifyInstance): void {
    fastify.addHook('onSend', (_request, reply, _payload, done) => {
      reply.headers({ 'content-type': 'application/json' });
      done();
    });
  }

  function setupRateLimiting(fastify: FastifyInstance): void {
    if (Config.get<number>('FASTIFY_RATE_LIMIT') > 0) {
      // Add rate limiter, taking the defaults. Note this uses an in-memory store by default, better multi-server
      // effectiveness requires configuring for redis or an alternative store
      fastify.register(FastifyRateLimit);
    }
  }

  function configureAcceptedContentTypes(fastify: FastifyInstance): void {
    fastify.addContentTypeParser(
      ['application/json', 'application/x-www-form-urlencoded'],
      { parseAs: 'string' },
      (_req, payload, done) => {
        done(null, payload);
      },
    );
  }

  function configureRouting(fastify: FastifyInstance): void {
    const stage: string = Config.get('MEADOWLARK_STAGE');

    // Matching crud operations handlers
    fastify.get(`/${stage}/*`, get);
    fastify.post(`/${stage}/*`, upsert);
    fastify.put(`/${stage}/*`, update);
    fastify.delete(`/${stage}/*`, deleteIt);

    // API version handler
    fastify.get(`/${stage}`, apiVersion);
    fastify.get(`/${stage}/`, apiVersion);

    // Swagger handlers
    fastify.get(`/${stage}/metadata`, openApiUrlList);
    fastify.get(`/${stage}/metadata/`, openApiUrlList);
    fastify.get(`/${stage}/metadata/resources/swagger.json`, swaggerForResourcesAPI);
    fastify.get(`/${stage}/metadata/descriptors/swagger.json`, swaggerForDescriptorsAPI);
    fastify.get(`/${stage}/metadata/data/v3/dependencies`, dependencies);
    fastify.get(`/${stage}/metadata/xsd`, xsdMetadata);

    // Descriptor loader
    fastify.get(`/${stage}/loadDescriptors`, loadDescriptors);

    // Authorization server handlers
    fastify.get(`/${stage}/oauth/clients`, getClientsHandler);
    fastify.get(`/${stage}/oauth/clients/:clientId`, getClientByIdHandler);
    fastify.post(`/${stage}/oauth/clients/:clientId/reset`, resetAuthorizationClientSecretHandler);
    fastify.post(`/${stage}/oauth/clients`, createAuthorizationClientHandler);
    fastify.put(`/${stage}/oauth/clients/*`, updateAuthorizationClientHandler);
    fastify.post(`/${stage}/oauth/token`, requestTokenAuthorizationHandler);
    fastify.post(`/${stage}/oauth/token/`, requestTokenAuthorizationHandler);
    fastify.post(`/${stage}/oauth/verify`, verifyTokenAuthorizationHandler);
    fastify.post(`/${stage}/oauth/verify/`, verifyTokenAuthorizationHandler);
    fastify.get(`/${stage}/oauth/createSigningKey`, createSigningKeyHandler);
  }
}
