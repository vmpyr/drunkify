const port = process.env.PORT ?? '3000';

try {
  const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
