import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TradeVero API')
    .setDescription(
      [
        'Wallet-first eSIM commerce API.',
        '',
        '## Authentication (Clerk)',
        'Protected routes require a Clerk session JWT:',
        '',
        '`Authorization: Bearer <clerk_session_jwt>`',
        '',
        'Use the **Authorize** button in Swagger and paste the token (without the `Bearer ` prefix).',
        '',
        '## Frontend signup / DB sync flow',
        'There is **no NestJS `/signup` endpoint**. Clerk owns sign-up and sign-in.',
        '',
        '1. User signs up or signs in via **Clerk** on the frontend (email, OAuth, etc.).',
        '2. Frontend obtains a Clerk session JWT (`getToken()` / session token).',
        '3. Frontend calls any protected endpoint (recommended first call: `GET /api/v1/users/me`) with the Bearer token.',
        '4. Backend verifies the JWT with Clerk, loads the Clerk user, then **upserts** into Postgres by `clerkId`:',
        '   - **First request** → creates `users` row + `wallets` row (balance `0`, currency `USD`).',
        '   - **Later requests** → updates `email` and `role` from Clerk (role is a cache; Clerk remains source of truth).',
        '5. Response `id` is TradeVero’s internal user UUID — use this for app identity, not the Clerk user id alone.',
        '',
        'Call `GET /users/me` once after login before wallet/orders flows so the local user + wallet exist.',
        '',
        '## Admin access',
        'Admin routes require a Clerk admin claim: `publicMetadata.role = "admin"` and/or Clerk org role `org:admin`.',
        'Local `users.role` is denormalized only and is not the sole admin check.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description:
        'Clerk session JWT from the frontend. After Authorize, call GET /users/me to sync the user into the TradeVero DB (creates user + zero-balance wallet on first hit).',
    })
    .addTag(
      'users',
      'Current user. First authenticated call upserts Clerk user → Postgres user + wallet.',
    )
    .addTag('health')
    .addTag('wallet')
    .addTag('payments')
    .addTag(
      'products',
      'Public catalog + regions. Use GET /regions for country autocomplete, GET /products?country=Japan to search.',
    )
    .addTag('orders')
    .addTag(
      'admin',
      'Requires Clerk admin role (publicMetadata.role=admin or org:admin).',
    )
    .addTag(
      'webhooks',
      'Provider callbacks. No Clerk auth — verified via provider signatures.',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const config = app.get(ConfigService<Env, true>);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}

bootstrap();
