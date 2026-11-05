import { NearWalletProvider } from './components/NearWalletProvider';
import { NearDemo } from './components/NearDemo';
import { NearAgentsApp } from './components/NearAgentsApp';

export default function App() {
  return <NearWalletProvider>{import.meta.env.VITE_PUMP_HOSTED !== '1' && window.location.pathname.startsWith('/demo') ? <NearDemo /> : <NearAgentsApp />}</NearWalletProvider>;
}
