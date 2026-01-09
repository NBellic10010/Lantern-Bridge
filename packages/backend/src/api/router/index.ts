import { router } from '../trpc';
import { walletRouter } from './wallet';
import { bridgeRouter } from './bridge';
import { stakingRouter } from './staking';

export const appRouter = router({
  wallet: walletRouter,
  bridge: bridgeRouter,
  staking: stakingRouter,
});

export type AppRouter = typeof appRouter;

