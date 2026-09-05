// Habitap API entity shapes (only the fields we use).

export interface Category {
  id: number;
  name: string;
  sequenceOrder?: number;
}

export interface HabitapDoc {
  id: number;
  caption: string;
  description?: string;
  filePath?: string;
  externalUrl?: string;
  fileType?: string;
}

export interface AccountInfo {
  username?: string;
  fullName?: string;
  unitNo?: string;
  blockCode?: string;
  condoName?: string;
  condoId: number;
}

/** Sealed into the browser cookie; the server keeps no copy. */
export interface SessionBlob {
  cookies: Record<string, string>;
  installationId: string;
  email: string;
  account: AccountInfo;
}
