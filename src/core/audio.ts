// Re-export audio capture functionality.
// The actual implementation lives in the original audio module which
// depends on native binaries (audiotee, ffmpeg).
export {
  checkMacOSVersion,
  createAudioRecorder,
  listAvfoundationDevices,
  selectAudioDevice,
  formatDevices,
  spawnFfmpeg,
  type AudioRecorder,
} from "../audio";
