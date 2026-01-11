import { router } from '../trpc';
import { transactionRouter } from './transaction';
import { userRouter } from './user';
import { configRouter } from './config';
import { statsRouter } from './stats';
import { bridgeRouter } from './bridge';
import { stakingRouter } from './staking';
import { walletRouter } from './wallet';

export const appRouter = router({
  transaction: transactionRouter,
  user: userRouter,
  config: configRouter,
  stats: statsRouter,
  bridge: bridgeRouter,
  staking: stakingRouter,
  wallet: walletRouter,
});

export type AppRouter = typeof appRouter;
