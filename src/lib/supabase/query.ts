export type TypedQueryError = {
  message: string
  code?: string | null
  details?: string | null
  hint?: string | null
}

export type TypedRowsQueryResult<T> = {
  data: T[] | null
  error: TypedQueryError | null
}

export type TypedMaybeSingleQueryResult<T> = {
  data: T | null
  error: TypedQueryError | null
}

export async function readRowsQuery<T>(
  query: PromiseLike<unknown>,
): Promise<TypedRowsQueryResult<T>> {
  return (await query) as TypedRowsQueryResult<T>
}

export async function readMaybeSingleQuery<T>(
  query: PromiseLike<unknown>,
): Promise<TypedMaybeSingleQueryResult<T>> {
  return (await query) as TypedMaybeSingleQueryResult<T>
}
