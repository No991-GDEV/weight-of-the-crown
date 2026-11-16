/** O Foundry sincroniza serverTime entre os navegadores, mesmo com relógios locais diferentes. */
export function rpcNow(): number {
  const time = game.time?.serverTime;
  if (typeof time !== "number" || !Number.isFinite(time)) throw new Error("A sessão ainda está sincronizando o horário do servidor. Tente novamente em instantes.");
  return Math.trunc(time);
}
export function validateRequestTime(request: Record<string, unknown>, senderId: string, now: number, ttl: number): void {
  if (request.userId !== senderId) throw new Error("A identidade deste pedido não foi confirmada. Envie a alteração novamente.");
  if (!Number.isSafeInteger(request.createdAt) || !Number.isSafeInteger(request.expiresAt) || Number(request.createdAt) > now + 1000 || Number(request.expiresAt) <= now || Number(request.expiresAt) <= Number(request.createdAt) || Number(request.expiresAt) - Number(request.createdAt) > ttl) throw new Error("Este pedido expirou. Envie a alteração novamente.");
}
