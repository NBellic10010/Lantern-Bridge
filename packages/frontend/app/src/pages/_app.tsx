import '../styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';

import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

import { config } from '../wagmi';
import { trpc } from '../utils/trpc';

import { useState, useEffect } from 'react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient();

function MyApp({ Component, pageProps }: AppProps) {
  // 1. 添加一个状态来标记是否已挂载到客户端
  const [mounted, setMounted] = useState(false);

  // 2. useEffect 只会在客户端执行
  useEffect(() => {
    setMounted(true);
  }, []);

  // 3. 如果还没挂载（即在服务端），返回 null 或者 loading 占位符
  // 这样 RainbowKitProvider 就不会在服务端被渲染执行了
  if (!mounted) return null; 

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default trpc.withTRPC(MyApp);
