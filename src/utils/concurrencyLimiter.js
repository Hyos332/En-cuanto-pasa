function createConcurrencyLimiter({ max = 1, label = 'task' } = {}) {
    const limit = Math.max(1, Number.parseInt(max, 10) || 1);
    const queue = [];
    let active = 0;

    function runNext() {
        if (active >= limit || queue.length === 0) {
            return;
        }

        const item = queue.shift();
        active += 1;

        Promise.resolve()
            .then(item.task)
            .then(item.resolve, item.reject)
            .finally(() => {
                active -= 1;
                runNext();
            });
    }

    return function limitTask(task) {
        return new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });

            if (queue.length > 1) {
                console.log(`⏳ ${label} en cola: ${queue.length - 1}`);
            }

            setImmediate(runNext);
        });
    };
}

module.exports = { createConcurrencyLimiter };
