export interface Enrolment {
  /** PNG data URI — rendered in an <img>, so no raw SVG is injected into the page. */
  qrDataUrl: string;
  /** Shown so someone can type the key in if their camera cannot read the code. */
  secret: string;
  backupCodes: string[];
}

export interface SetupState {
  error: string | null;
  enrolment: Enrolment | null;
}

export const EMPTY_SETUP_STATE: SetupState = { error: null, enrolment: null };

export interface DisableState {
  error: string | null;
}

export const EMPTY_DISABLE_STATE: DisableState = { error: null };
