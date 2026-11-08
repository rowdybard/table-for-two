import { bindings, defineConfig, defineContainer, exports } from 'cf/config';

const name = process.env.CF_WORKER_NAME || 'table-for-two';
const runtime = defineContainer({ name: `${name}-runtime`, schedulingPolicy: 'durable-object' });

export default defineConfig({
  worker: {
    name,
    entrypoint: './worker.ts',
    compatibilityDate: '2026-11-08',
    compatibilityFlags: ['enable_request_signal'],
    workersDev: true,
    assets: { runWorkerFirst: true, htmlHandling: 'none', notFoundHandling: 'none' },
    env: {
      ASSETS: bindings.assets(),
      RUNTIME: bindings.durableObject({ worker: name, exportName: 'RestaurantRuntime' }),
      DATE_ALLOW_MODEL_SELECTION: bindings.text('1'),
    },
    exports: {
      RestaurantRuntime: exports.durableObject({ storage: 'sqlite', container: runtime }),
      BudgetBridge: exports.worker(),
    },
    observability: { enabled: true },
    unsafe: { metadata: { code_update_strategy: { mode: 'immediate' } } },
  },
  containers: [runtime],
});
