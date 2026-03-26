import { Metadata } from 'next';
import HomePage from './home-page';

export const metadata: Metadata = {
  title: {
    default: 'Linksy',
    template: '%s | Linksy',
  },
  description:
    'The open-source AI interactive classroom. Upload a PDF to instantly generate an immersive, multi-agent learning experience.',
  icons: {
    icon: '/logo_i.png',
    shortcut: '/logo_i.png',
    apple: '/logo_i.png',
  },
};

export default function Home() {
  return <HomePage />;
}
