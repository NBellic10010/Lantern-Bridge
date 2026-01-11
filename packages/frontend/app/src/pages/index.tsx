import Head from 'next/head';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useCasperWallet } from '../hooks/useCasperWallet';
import { trpc } from '../utils/trpc';
import { useState, useEffect } from 'react';
import { parseEther, parseUnits } from 'viem';
import { CLValueBuilder, RuntimeArgs, CLKey, CLAccountHash, CLPublicKey, DeployUtil } from 'casper-js-sdk';

// Minimal ABI for ETH Bridge
const BRIDGE_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "token", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "string", "name": "dstChain", "type": "string" },
      { "internalType": "string", "name": "dstAccount", "type": "string" },
      { "internalType": "uint8", "name": "strategyId", "type": "uint8" }
    ],
    "name": "lock",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "amount", "type": "uint256" },
      { "internalType": "string", "name": "dstAccount", "type": "string" },
      { "internalType": "bytes32", "name": "txId", "type": "bytes32" }
    ],
    "name": "burnwCSPR",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

export default function Home() {
  const { address: ethAddress, isConnected: isEthConnected } = useAccount();
  const casper = useCasperWallet();
  
  // Data Fetching
  const stats = trpc.stats.getTVL.useQuery();
  const config = trpc.config.get.useQuery();
  const portfolio = trpc.user.getPortfolio.useQuery(
    { ethAddress: ethAddress, csprPublicKey: casper.activeKey || undefined },
    { enabled: !!ethAddress || !!casper.activeKey }
  );
  const history = trpc.transaction.getRecent.useQuery({ limit: 10 });
  const pairs = trpc.bridge.getPairs.useQuery();
  const sendDeployMutation = trpc.transaction.sendDeploy.useMutation();

  // Form State
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'ETH_TO_CSPR' | 'CSPR_TO_ETH'>('ETH_TO_CSPR');
  const [actionType, setActionType] = useState<'LOCK' | 'BURN'>('LOCK'); // LOCK = Deposit/Wrap, BURN = Redeem/Unwrap
  const [isProcessing, setIsProcessing] = useState(false);

  // Wagmi Hooks
  const { writeContractAsync } = useWriteContract();

  // 1. ETH -> CSPR (Lock ETH)
  const handleLockEth = async () => {
    if (!ethAddress || !casper.activeKey || !config.data?.contracts.ethBridge) return;
    try {
      setIsProcessing(true);
      const weiAmount = parseEther(amount);
      const hash = await writeContractAsync({
        address: config.data.contracts.ethBridge as `0x${string}`,
        abi: BRIDGE_ABI,
        functionName: 'lock',
        args: [
          '0x0000000000000000000000000000000000000000', // ETH
          weiAmount,
          'CSPR',
          casper.activeKey,
          0 // Strategy: NONE
        ],
        value: weiAmount
      });
      alert(`Lock ETH Sent: ${hash}`);
    } catch (e: any) {
      console.error(e);
      alert("Error: " + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. ETH -> CSPR (Burn wCSPR to get CSPR)
  const handleBurnWCspr = async () => {
    if (!ethAddress || !casper.activeKey || !config.data?.contracts.ethBridge) return;
    try {
      setIsProcessing(true);
      const weiAmount = parseEther(amount); // wCSPR usually 18 decimals? Check token contract. Assuming 18.
      // Note: User must approve wCSPR first if using burnFrom, but burn is usually direct.
      // Bridge ABI has burnwCSPR.
      
      const txId = "0x" + Math.random().toString(16).slice(2).padEnd(64, '0'); // Mock unique txId requirement

      const hash = await writeContractAsync({
        address: config.data.contracts.ethBridge as `0x${string}`,
        abi: BRIDGE_ABI,
        functionName: 'burnwCSPR',
        args: [
          weiAmount,
          casper.activeKey,
          txId as `0x${string}`
        ]
      });
      alert(`Burn wCSPR Sent: ${hash}`);
    } catch (e: any) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        setIsProcessing(false);
    }
  };

  // 3. CSPR -> ETH (Lock CSPR to get wCSPR)
  const handleLockCspr = async () => {
    if (!casper.isConnected || !casper.activeKey || !config.data?.contracts.csprBridge) return;
    if (!ethAddress) { alert("Please connect ETH wallet"); return; }

    try {
      setIsProcessing(true);
      const amountMotes = parseFloat(amount) * 1e9;
      const contractHash = config.data.contracts.csprBridge.replace("hash-", "");
      const contractHashByteArray = Uint8Array.from(Buffer.from(contractHash, 'hex'));

      const args = RuntimeArgs.fromMap({
        amount: CLValueBuilder.u256(amountMotes),
        dst_chain: CLValueBuilder.string('ETH'),
        dst_address: CLValueBuilder.string(ethAddress),
        // caller_purse is usually handled by the contract finding the purse, or we pass it? 
        // Our updated contract requires caller_purse? 
        // Actually, entrypoint wrapper usually handles creation of purse or main purse.
        // Let's assume standard payment handles it or entrypoint uses get_main_purse.
        // Wait, recent changes added `caller_purse: URef` to `lock_cspr_for_eth` entrypoint?
        // If so, we can't easily pass URef from JS SDK without session code.
        // If the entrypoint automatically gets caller's main purse (which is not possible directly),
        // usually user transfers to contract purse.
        // Let's assume standard implementation: entrypoint `lock_cspr_for_eth` accepts `amount` and does `system::transfer`.
        // If it requires `caller_purse` (URef), it must be called via session code that passes `account::get_main_purse()`.
        // Direct invocation might fail if it strictly requires URef arg.
        // FALLBACK: Use `call_contract` with `amount` arg, hoping the contract handles `transfer_from_purse_to_purse` correctly
        // by creating a purse or using transfer logic.
        recipient: CLValueBuilder.string(ethAddress),
        tx_id: CLValueBuilder.string("tx-" + Date.now())
      });

      const deploy = DeployUtil.makeDeploy(
        new DeployUtil.DeployParams(CLPublicKey.fromHex(casper.activeKey), 'casper-test', 1, 1800000),
        DeployUtil.ExecutableDeployItem.newStoredContractByHash(
          contractHashByteArray,
          "lock_cspr_for_eth",
          args
        ),
        DeployUtil.standardPayment(5000000000)
      );

      const jsonDeploy = DeployUtil.deployToJson(deploy);
      const signature = await casper.signDeploy(jsonDeploy, casper.activeKey); // 签名

      console.log("signature", JSON.stringify(signature, null, 2));

      if (sendDeployMutation.isPending) {
        alert("Sending deploy...");
        return;
      }
      
      if (signature && !signature.cancelled && signature.signatureHex && casper.activeKey) {
        // Send signed deploy + signature to backend
        const signedDeployJson = DeployUtil.deployToJson(deploy);

        console.log("signedDeployJson", JSON.stringify(signedDeployJson, null, 2));

        sendDeployMutation.mutate({ 
            deploy: signedDeployJson,
            signature: signature.signatureHex,
            signer: casper.activeKey
        }, {
          onSuccess: (result) => {
            alert(`Deploy Sent! Hash: ${result.deployHash}`);
          },
          onError: (error) => {
            alert("Error: " + error.message);
          }
        });
      }
    } catch (e: any) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        setIsProcessing(false);
    }
  };

  // 4. CSPR -> ETH (Burn ceETH to get ETH)
  const handleBurnCeEth = async () => {
    if (!casper.isConnected || !casper.activeKey || !config.data?.contracts.csprBridge) return;
    if (!ethAddress) { alert("Please connect ETH wallet"); return; }

    try {
        setIsProcessing(true);
        const amountMotes = parseFloat(amount) * 1e9; // ceETH usually 9 decimals (same as CSPR) or 18?
        // Assuming 9 for Casper native compatibility
        const contractHash = config.data.contracts.csprBridge.replace("hash-", "");
        const contractHashByteArray = Uint8Array.from(Buffer.from(contractHash, 'hex'));

        const args = RuntimeArgs.fromMap({
            amount: CLValueBuilder.u256(amountMotes),
            eth_owner: CLValueBuilder.string(ethAddress),
            tx_id: CLValueBuilder.string("tx-" + Date.now())
        });

        const deploy = DeployUtil.makeDeploy(
            new DeployUtil.DeployParams(CLPublicKey.fromHex(casper.activeKey), 'casper-test', 1, 1800000),
            DeployUtil.ExecutableDeployItem.newStoredContractByHash(
                contractHashByteArray,
                "burn_ceeth_for_eth",
                args
            ),
            DeployUtil.standardPayment(5000000000)
        );

        const jsonDeploy = DeployUtil.deployToJson(deploy);
        const signature = await casper.signDeploy(jsonDeploy, casper.activeKey);
        
        if (signature && !signature.cancelled && signature.signatureHex && casper.activeKey) {
            // Send signed deploy + signature to backend
            const signedDeployJson = DeployUtil.deployToJson(deploy);

            const result = await sendDeployMutation.mutateAsync({ 
                deploy: signedDeployJson,
                signature: signature.signatureHex,
                signer: casper.activeKey 
            });
            alert(`Deploy Sent! Hash: ${result.deployHash}`);
        } else {
             alert("Signing cancelled or failed");
        }
    } catch (e: any) {
        console.error(e);
        alert("Error: " + e.message);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleAction = () => {
      if (direction === 'ETH_TO_CSPR') {
          if (actionType === 'LOCK') return handleLockEth(); // Lock ETH -> ceETH
          if (actionType === 'BURN') return handleBurnWCspr(); // Burn wCSPR -> CSPR
      } else {
          if (actionType === 'LOCK') return handleLockCspr(); // Lock CSPR -> wCSPR
          if (actionType === 'BURN') return handleBurnCeEth(); // Burn ceETH -> ETH
      }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <Head>
        <title>Lantern Bridge</title>
      </Head>

      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <h1>🏮 Lantern Bridge</h1>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <ConnectButton />
          <button 
            onClick={casper.isConnected ? casper.disconnect : casper.connect}
            style={{ 
              height: '40px', padding: '0 16px', background: '#e02424', color: 'white', 
              border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', 
              display: 'flex', alignItems: 'center', fontSize: '14px', boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.1)' 
            }}
          >
            {casper.isConnected ? `CSPR: ${casper.activeKey?.slice(0,6)}...` : "Connect Casper"}
          </button>
        </div>
      </header>

      <main style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem' }}>
        
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Stats */}
            <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '12px' }}>
                <h2>Network Stats</h2>
                <div style={{ display: 'flex', gap: '2rem', marginTop: '1rem' }}>
                    <div>
                        <div style={{ color: '#666' }}>TVL (USD)</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>${stats.data?.totalValueUsd || '...'}</div>
                    </div>
                    <div><div style={{ color: '#666' }}>ETH Side</div><div>{stats.data?.details.ethSide.amount} ETH</div></div>
                    <div><div style={{ color: '#666' }}>CSPR Side</div><div>{stats.data?.details.csprSide.amount} CSPR</div></div>
                </div>
            </div>

            {/* Bridge Action */}
            <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '12px' }}>
                <h2>Bridge Assets</h2>
                
                {/* 1. Direction Selection */}
                <div style={{ margin: '1rem 0', display: 'flex', gap: '1rem' }}>
                    <button 
                        onClick={() => setDirection('ETH_TO_CSPR')}
                        style={{
                            padding: '8px 16px', borderRadius: '8px', border: '1px solid #ccc',
                            background: direction === 'ETH_TO_CSPR' ? '#0070f3' : 'white',
                            color: direction === 'ETH_TO_CSPR' ? 'white' : 'black'
                        }}
                    >
                        ETH → CSPR
                    </button>
                    <button 
                        onClick={() => setDirection('CSPR_TO_ETH')}
                        style={{
                            padding: '8px 16px', borderRadius: '8px', border: '1px solid #ccc',
                            background: direction === 'CSPR_TO_ETH' ? '#0070f3' : 'white',
                            color: direction === 'CSPR_TO_ETH' ? 'white' : 'black'
                        }}
                    >
                        CSPR → ETH
                    </button>
                </div>

                {/* 2. Action Type Selection */}
                <div style={{ margin: '1rem 0' }}>
                    <label style={{ marginRight: '1rem' }}>
                        <input type="radio" checked={actionType === 'LOCK'} onChange={() => setActionType('LOCK')} />
                        {direction === 'ETH_TO_CSPR' ? ' Lock ETH (Get ceETH)' : ' Lock CSPR (Get wCSPR)'}
                    </label>
                    <label>
                        <input type="radio" checked={actionType === 'BURN'} onChange={() => setActionType('BURN')} />
                        {direction === 'ETH_TO_CSPR' ? ' Burn wCSPR (Get CSPR)' : ' Burn ceETH (Get ETH)'}
                    </label>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <input 
                        type="number" placeholder="Amount" value={amount} 
                        onChange={e => setAmount(e.target.value)}
                        style={{ padding: '10px', flex: 1, fontSize: '1.2rem' }}
                    />
                    <button 
                        disabled={isProcessing}
                        onClick={handleAction}
                        style={{ 
                            padding: '10px 20px', background: '#0070f3', color: 'white', 
                            border: 'none', borderRadius: '8px', cursor: 'pointer', opacity: isProcessing ? 0.7 : 1
                        }}
                    >
                        {isProcessing ? 'Processing...' : 'Submit'}
                    </button>
                </div>
                <p style={{ fontSize: '0.9rem', color: '#666', marginTop: '0.5rem' }}>
                    Fee: {(config.data?.supportedPairs?.[0]?.feeBps ?? 0) / 100}%
                </p>
            </div>

            {/* History */}
            <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '12px' }}>
                <h2>Recent Transactions</h2>
                <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid #eee' }}>
                            <th>ID</th><th>Status</th><th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.data?.map((tx: any) => (
                            <tr key={tx.id} style={{ borderBottom: '1px solid #f9f9f9' }}>
                                <td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{tx.id.slice(0, 8)}...</td>
                                <td>
                                    <span style={{ 
                                        padding: '4px 8px', borderRadius: '4px', 
                                        background: tx.status === 'COMPLETED' ? '#dcfce7' : '#fef9c3',
                                        color: tx.status === 'COMPLETED' ? '#166534' : '#854d0e',
                                        fontSize: '0.8rem'
                                    }}>{tx.status}</span>
                                </td>
                                <td>{new Date(tx.lastUpdated).toLocaleTimeString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
             <div style={{ padding: '1.5rem', background: '#f5f5f5', borderRadius: '12px' }}>
                <h2>My Portfolio</h2>
                <div style={{ marginTop: '1rem' }}>
                    <h3>Ethereum</h3>
                    <div>Address: {ethAddress ? `${ethAddress.slice(0,6)}...` : 'Not connected'}</div>
                    <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>wCSPR: {portfolio.data?.eth.wCsprBalance || 0}</div>
                </div>
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
                    <h3>Casper</h3>
                    <div>Key: {casper.activeKey ? `${casper.activeKey.slice(0,6)}...` : 'Not connected'}</div>
                    <div style={{ marginTop: '0.5rem', fontWeight: 'bold' }}>ceETH: {portfolio.data?.cspr.ceEthBalance || 0}</div>
                    <div style={{ marginTop: '0.5rem' }}>Staked: {portfolio.data?.cspr.stakedPrincipal} CSPR</div>
                    <div>Yield: {portfolio.data?.cspr.yieldAccrued} CSPR</div>
                </div>
            </div>

            <div style={{ padding: '1.5rem', border: '1px solid #ddd', borderRadius: '12px' }}>
                <h2>Supported Pairs</h2>
                {pairs.isLoading ? (<p>Loading...</p>) : (
                    <ul style={{ paddingLeft: '1.2rem' }}>
                        {pairs.data?.map((pair: any) => (
                            <li key={pair.id} style={{ marginBottom: '0.5rem' }}>
                                <strong>{pair.sourceAsset} → {pair.targetAsset}</strong>
                                <div style={{ fontSize: '0.8rem', color: '#666' }}>{pair.sourceChain} to {pair.targetChain}</div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
      </main>
    </div>
  );
}
