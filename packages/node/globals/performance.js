// TODO move to browser workspace dir?
export const performance = () => {
    // based on https://gist.github.com/paulirish/5438650 copyright Paul Irish 2015.
    const performance = {};
  
    Date.now = (Date.now || (() => { // thanks IE8
      return new Date().getTime()
    }))
  
    if ('now' in performance === false) {
      let nowOffset = Date.now()
  
      if (performance.timing?.navigationStart) {
        nowOffset = performance.timing.navigationStart
      }
  
      performance.now = () => Date.now() - nowOffset
    }
    return performance;
  }