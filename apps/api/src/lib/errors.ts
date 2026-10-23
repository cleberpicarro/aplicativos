export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(422, m);
export const forbidden = (m = 'Você não tem permissão para esta ação.') => new HttpError(403, m);
export const notFound = (m = 'Não encontrado.') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);
export const unauthorized = (m = 'Faça login para continuar.') => new HttpError(401, m);
