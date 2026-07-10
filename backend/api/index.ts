/**
 * Vercel serverless entry point. Vercel doesn't run a long-lived
 * `app.listen()` process — every request invokes this function, so the
 * Nest app is built once per warm container and cached at module scope
 * (`serverPromise`) instead of per-request. Cold starts pay Nest's DI
 * bootstrap cost once; warm invocations reuse it.
 *
 * This mirrors src/main.ts's middleware/prefix/CORS/filter setup exactly
 * — main.ts stays the entry point for local dev (`nest start`) and any
 * non-serverless deployment; this file is Vercel-only.
 */
import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import compression from 'compression';
import express, { Express } from 'express';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

let serverPromise: Promise<Express> | null = null;

async function createServer(): Promise<Express> {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  app.use(helmet());
  app.use(compression());
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.init();
  return expressApp;
}

function getServer(): Promise<Express> {
  if (!serverPromise) {
    serverPromise = createServer();
  }
  return serverPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const server = await getServer();
  server(req, res);
}
