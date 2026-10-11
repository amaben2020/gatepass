// A failure that's the client's fault (4xx). The error handler in app.ts replies with `status` and `{ error, code }`;
// `code` is stable for the app to switch on ("NO_PASS" → back to the waiting room), `message` is for humans.
export class HttpError extends Error {
  readonly expose = true;

  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
