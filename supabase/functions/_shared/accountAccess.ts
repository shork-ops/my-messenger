/** Check current DB session and MFA before any service-role work. Fail closed if migration is missing. */
export async function enforceAccountAccess(client: { rpc(name: string): PromiseLike<{ error: unknown }> }): Promise<boolean> {
  try {
    const { error } = await client.rpc("assert_account_access");
    return !error;
  } catch { return false; }
}
