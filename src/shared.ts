/** Settings namespace joining the Host configuration and Web card. */
export const LEISURE_SETTINGS_NAMESPACE = 'leisure-time-queue'

/** Shared authenticated Connection channel used by DSH 0.1.5 and later. */
export const LEISURE_RPC_CHANNEL = '/api'
/** Single exact endpoint claimed by this plugin below the shared API channel. */
export const LEISURE_RPC_ENDPOINT = 'leisure-time-queue'
/** Host Fetch route corresponding to the logical endpoint. */
export const LEISURE_RPC_PATH = `${LEISURE_RPC_CHANNEL}/${LEISURE_RPC_ENDPOINT}`
