const { InvestmentStore } = require('./investment-store.cjs');

function installOperationLogger(payload = {}) {
  if (process.env.KAI_OPERATION_PARENT_ID) {
    // 作为父任务（serve 采集任务）的子进程运行时，日志由父任务统一收尾，
    // 这里只透传父任务 id，并提供安全的空实现，避免子进程调用 finish* 崩溃。
    const operationId = Number(process.env.KAI_OPERATION_PARENT_ID) || null;
    return {
      operationId,
      finishSuccess: () => {},
      finishFailed: () => {},
    };
  }

  let store;
  let operation;
  let finished = false;
  let output = '';
  try {
    store = new InvestmentStore();
    operation = store.startOperation({ ...payload, triggerSource: payload.triggerSource || 'cli' });
    process.env.KAI_OPERATION_PARENT_ID = String(operation.id);
  } catch (error) {
    process.stderr.write(`运行日志初始化失败：${error.message}\n`);
    return { operationId: null };
  }

  const capture = (chunk) => {
    output += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    if (output.length > 20000) output = output.slice(-20000);
  };
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...args) => {
    capture(chunk);
    return stdoutWrite(chunk, ...args);
  };
  process.stderr.write = (chunk, ...args) => {
    capture(chunk);
    return stderrWrite(chunk, ...args);
  };

  const finish = (status, summary, metadata = {}) => {
    if (finished) return;
    finished = true;
    try {
      const failed = status === 'failed';
      store.finishOperation(operation.id, {
        status: failed ? 'failed' : 'success',
        summary: summary || (failed
          ? `${payload.title || '系统任务'}失败`
          : (payload.successSummary || `${payload.title || '系统任务'}完成`)),
        details: output,
        metadata: { ...(payload.metadata || {}), ...metadata },
      });
    } catch (error) {
      stderrWrite(`运行日志完成状态写入失败：${error.message}\n`);
    } finally {
      try { store.close(); } catch {}
    }
  };

  process.once('exit', (code) => {
    finish(
      code === 0 ? 'success' : 'failed',
      code === 0 ? '' : `${payload.title || '系统任务'}失败（退出码 ${code}）`,
      { exitCode: code },
    );
  });

  return {
    operationId: operation.id,
    finishSuccess: (summary, metadata) => finish('success', summary, metadata),
    finishFailed: (summary, metadata) => finish('failed', summary, metadata),
  };
}

module.exports = { installOperationLogger };
