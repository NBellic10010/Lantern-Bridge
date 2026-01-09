import * as trpcExpress from '@trpc/server/adapters/express';
import express from 'express';
import cors from 'cors';
import { appRouter } from './router';
import { createContext } from './context';

const app = express();
const port = 4000;

app.use(cors());

app.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

app.listen(port, () => {
  console.log(`API Server running on port ${port}`);
});
