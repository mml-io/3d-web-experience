import {
  AnimationClip,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from "three";

export function createMegaTimeline(
  individualClips: Map<string, AnimationClip>,
): [Map<string, { startTime: number; endTime: number; duration: number }>, AnimationClip] {
  const segments = new Map<
    string,
    { clip: AnimationClip; startTime: number; endTime: number; duration: number }
  >();
  let currentTime = 0;

  // small gap between animations to prevent (maybe we'd have blending issues?)
  const gap = 0.1;

  // segments for each animation
  for (const [name, clip] of individualClips.entries()) {
    const startTime = currentTime;
    const duration = clip.duration;
    const endTime = startTime + duration;

    segments.set(name, { clip, startTime, endTime, duration });

    currentTime = endTime + gap;
  }

  // create the tracks
  const megaTracks: any[] = [];
  const totalDuration = currentTime - gap;

  // name 'em all from the respective clips
  const allTrackNames = new Set<string>();
  for (const [, segment] of segments) {
    for (const track of segment.clip.tracks) {
      allTrackNames.add(track.name);
    }
  }

  // create a merged track for each
  for (const trackName of allTrackNames) {
    const mergedTimes: number[] = [];
    const mergedValues: number[] = [];
    let valueSize = 0;

    for (const [, segment] of segments) {
      // find the track in this segment's clip
      const track = segment.clip.tracks.find((t) => t.name === trackName);

      if (track) {
        valueSize = track.getValueSize();

        // add track's keyframes, offset by the segment's start time
        for (let i = 0; i < track.times.length; i++) {
          const offsetTime = track.times[i] + segment.startTime;
          mergedTimes.push(offsetTime);

          // copy the values for the keyframe
          for (let j = 0; j < valueSize; j++) {
            mergedValues.push(track.values[i * valueSize + j]);
          }
        }
      } else {
        // here the track doesn't exist in the segment, so we'll use identity/default
        // values
        const defaultValues = getDefaultTrackValues(trackName, valueSize || 3);

        // start of segment
        mergedTimes.push(segment.startTime);
        mergedValues.push(...defaultValues);
        // end of segment
        mergedTimes.push(segment.endTime);
        mergedValues.push(...defaultValues);
      }
    }

    // create the merged track
    if (mergedTimes.length > 0 && valueSize > 0) {
      const TrackType = getTrackTypeFromName(trackName);
      const mergedTrack = new TrackType(trackName, mergedTimes, mergedValues);
      megaTracks.push(mergedTrack);
    }
  }

  // create the MEGA animation clip (everything is cooler when you call it mega-something)
  return [segments, new AnimationClip("MegaTimeline", totalDuration, megaTracks)];
}

function getDefaultTrackValues(trackName: string, valueSize: number): number[] {
  const [, property] = trackName.split(".");
  if (property === "position") {
    return [0, 0, 0];
  } else if (property === "quaternion") {
    return [0, 0, 0, 1];
  } else if (property === "scale") {
    return [1, 1, 1];
  }
  return new Array(valueSize).fill(0);
}

function getTrackTypeFromName(trackName: string): any {
  const [, property] = trackName.split(".");
  if (property === "position") {
    return VectorKeyframeTrack;
  } else if (property === "quaternion") {
    return QuaternionKeyframeTrack;
  } else if (property === "scale") {
    return VectorKeyframeTrack;
  }
  return NumberKeyframeTrack;
}
