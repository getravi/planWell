// jsdom stubs for browser APIs not implemented in the test environment
Element.prototype.scrollIntoView = () => {};
window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.EventSource = class EventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
} as unknown as typeof EventSource;
