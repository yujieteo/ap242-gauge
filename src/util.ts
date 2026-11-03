export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error('missing ' + what);
  return value;
}

export function at(array: ArrayLike<number>, index: number): number {
  const value = array[index];
  if (value === undefined) throw new Error('index ' + index + ' is outside 0..' + (array.length - 1));
  return value;
}
