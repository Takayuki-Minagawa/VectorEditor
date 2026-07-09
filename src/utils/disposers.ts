export type Disposer = () => void;

export function disposeAll(disposers: Disposer[]): Disposer {
  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
