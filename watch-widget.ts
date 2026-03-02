import { watch } from 'fs';
import { join } from 'path';

const agentRoot = new URL('.', import.meta.url).pathname;
const widgetDir = join(agentRoot, 'src', 'widget');

async function build() {
  const result = await Bun.build({
    entrypoints: [join(agentRoot, 'src/widget/index.tsx')],
    outdir: join(agentRoot, 'dist'),
    naming: 'widget.js',
    target: 'browser',
    format: 'iife',
    minify: false,
    sourcemap: 'none',
    define: {
      'process.env.NODE_ENV': '"development"'
    },
    external: []
  });

  if (!result.success) {
    console.error('Widget build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    return;
  }

  const sizeKB = (result.outputs[0].size / 1024).toFixed(1);
  console.log(
    `[${new Date().toLocaleTimeString()}] Widget rebuilt (${sizeKB} KB)`
  );
}

// Initial build
await build();

// Watch for changes
console.log(`Watching ${widgetDir} for changes...`);
watch(widgetDir, { recursive: true }, async (event, filename) => {
  if (filename?.endsWith('.ts') || filename?.endsWith('.tsx')) {
    await build();
  }
});
