import { NearWalletProvider } from './components/NearWalletProvider';
import { NearDemo } from './components/NearDemo';
import { NearAgentsApp } from './components/NearAgentsApp';

export default function App() {
  return <NearWalletProvider>{window.location.pathname.startsWith('/demo') ? <NearDemo /> : <NearAgentsApp />}</NearWalletProvider>;
}
