import { useState, useEffect, useCallback } from 'react';

export interface CasperWalletState {
  isConnected: boolean;
  activeKey: string | null;
  isLocked: boolean;
}

export const useCasperWallet = () => {
  const [state, setState] = useState<CasperWalletState>({
    isConnected: false,
    activeKey: null,
    isLocked: false,
  });

  const [provider, setProvider] = useState<any>(null);

  useEffect(() => {
    // Poll for the provider or wait for load event
    const checkProvider = () => {
      if ((window as any).CasperWalletProvider) {
        const providerInstance = (window as any).CasperWalletProvider();
        setProvider(providerInstance);
        return true;
      }
      return false;
    };

    if (!checkProvider()) {
       window.addEventListener('load', checkProvider);
       return () => window.removeEventListener('load', checkProvider);
    }
  }, []);

  const updateState = useCallback(async () => {
    if (!provider) return;
    try {
        const isConnected = await provider.isConnected();
        if (isConnected) {
            const activeKey = await provider.getActivePublicKey();
            setState({
                isConnected: true,
                activeKey: activeKey,
                isLocked: false
            });
        } else {
            setState(s => ({ ...s, isConnected: false, activeKey: null }));
        }
    } catch (e) {
        console.error("Casper wallet error:", e);
    }
  }, [provider]);

  useEffect(() => {
    if (provider) {
        updateState();
        // Setup listeners if supported by the provider version
        // provider.on('connected', updateState);
        // provider.on('disconnected', updateState);
        // provider.on('activeKeyChanged', updateState);
    }
  }, [provider, updateState]);

  const connect = async () => {
    if (!provider) {
        alert("Casper Wallet extension not detected!");
        return;
    }
    try {
        await provider.requestConnection();
        await updateState();
    } catch (e) {
        console.error(e);
    }
  };

  const disconnect = async () => {
      if (!provider) return;
      try {
          await provider.disconnectFromSite();
          await updateState();
      } catch (e) {
          console.error(e);
      }
  };

  const signDeploy = async (deploy: any, senderPublicKey: string): Promise<{ cancelled: boolean; signatureHex?: string }> => {
      if (!provider) throw new Error("No provider");
      // This matches the Casper Wallet API
      return await provider.sign(JSON.stringify(deploy), senderPublicKey);
  };

  return {
    ...state,
    connect,
    disconnect,
    signDeploy,
    provider
  };
};

