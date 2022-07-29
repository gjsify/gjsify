// based on https://github.com/cabinjs/browser-hrtime

const hrtime = (previousTimestamp?: number) => {
    const baseNow = Math.floor((Date.now() - performance.now()) * 1e-3)
    const clocktime = performance.now() * 1e-3
    let seconds = Math.floor(clocktime) + baseNow
    let nanoseconds = Math.floor((clocktime % 1) * 1e9)

    if (previousTimestamp) {
        seconds = seconds - previousTimestamp[0]
        nanoseconds = nanoseconds - previousTimestamp[1]
        if (nanoseconds < 0) {
            seconds--
            nanoseconds += 1e9
        }
    }
    return [seconds, nanoseconds]
}

const NS_PER_SEC = 1e9
hrtime.bigint = () => {
    const diff = hrtime()
    return BigInt(diff[0] * NS_PER_SEC + diff[1])
}

export { hrtime, hrtime as default }