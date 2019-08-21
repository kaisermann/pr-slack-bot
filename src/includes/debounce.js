module.exports = function debounce(f, interval) {
  let timer = null;

  return (...args) => {
    clearTimeout(timer);
    return new Promise(resolve => {
      timer = setTimeout(() => resolve(f(...args)), interval);
    });
  };
};
