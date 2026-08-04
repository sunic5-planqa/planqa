export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
  }
}

export class NotImplementedError extends ApiError {
  constructor(detail: string) {
    super(501, detail)
  }
}
