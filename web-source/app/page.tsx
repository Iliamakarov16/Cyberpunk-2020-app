import { requireChatGPTUser } from './chatgpt-auth';
import Tracker from './tracker';
export const dynamic = 'force-dynamic';
export default async function Home() {
 await requireChatGPTUser('/');
 return <Tracker />;
}
