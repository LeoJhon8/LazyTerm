// Seed isolated storage before importing any application stores.
import './storage';

async function startDemo() {
  await import('../main');
  const [{ createRoot }, { DemoBadge }] = await Promise.all([import('react-dom/client'), import('./Badge')]);
  const badge = document.createElement('div');
  document.body.appendChild(badge);
  document.title = 'LazyTerm Demo';
  createRoot(badge).render(<DemoBadge />);
}
void startDemo();
