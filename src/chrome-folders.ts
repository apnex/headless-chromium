// chrome-folders - what Chrome makes in its temporary folder, and whether a temporary folder can hold it (CONTRACT.md HC1).
//
// Chrome makes a lock folder directly in its temporary folder, holding its singleton socket: `.com.google.Chrome.` and
// six letters or digits as Chrome 136 names it, or with no leading dot as a later Chrome names it. Stopping Chrome never
// removes it. A socket address holds 107 characters, and Chrome does not start when its lock socket's path is longer
// (measured: 108 stopped it), so a temporary folder too long for a launch folder and a lock socket beneath it is warned
// of, and refused by the launcher, before any Chrome is started.
import * as os from "os";
import * as path from "path";

/** The prefix of a launch folder's name, which six letters or digits follow, in the temporary folder. */
export const LAUNCH_FOLDER_PREFIX = "ch-";

/** The longest path a socket address holds. */
export const SOCKET_PATH_MAX = 107;

/** The name of the lock folder Chrome makes in its temporary folder, in either spelling. */
const LOCK_FOLDER_NAME = /^\.?com\.google\.Chrome\.[A-Za-z0-9]{6}$/;

/** The path of Chrome's lock socket in a launch folder made in `tmpdir`, the random parts written as Xs. */
const lockSocketPath = (tmpdir: string): string => `${path.join(tmpdir, `${LAUNCH_FOLDER_PREFIX}XXXXXX`)}/.com.google.Chrome.XXXXXX/SingletonSocket`;

/**
 * Whether a folder's name is one Chrome gives its lock folder: `com.google.Chrome.` and six letters or digits, with one
 * leading dot or none. A folder so named left in a temporary folder is a Chrome started outside a launch folder of its
 * own, or stopped without its removal.
 */
export function isLockFolderName(name: string): boolean {
	if (typeof name !== "string") throw new TypeError(`isLockFolderName: the name must be a string, not ${typeof name}`);
	return LOCK_FOLDER_NAME.test(name);
}

/**
 * A warning when Chrome's lock socket, in a launch folder made in `tmpdir` -- the temporary folder by default -- would be
 * longer than a socket address holds, naming the longest temporary folder that fits; null when it fits.
 */
export function lockSocketWarning(tmpdir: string = os.tmpdir()): string | null {
	if (typeof tmpdir !== "string" || !path.isAbsolute(tmpdir)) throw new TypeError(`lockSocketWarning: the temporary folder must be an absolute path, not ${JSON.stringify(tmpdir)}`);
	const base = path.resolve(tmpdir);
	const length = lockSocketPath(base).length;
	if (length <= SOCKET_PATH_MAX) return null;
	return `the temporary folder ${base} is too long for Chrome's lock socket (${length} > ${SOCKET_PATH_MAX} characters): a Chrome launched in it will not start; use a TMPDIR at most ${base.length - (length - SOCKET_PATH_MAX)} characters long`;
}
