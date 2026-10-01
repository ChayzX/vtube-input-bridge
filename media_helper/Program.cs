using System.Text.Json;
using Windows.Media.Control;
static void Reply(bool ok, object? data = null, string? code = null) => Console.WriteLine(JsonSerializer.Serialize(new { ok, data, code }));
try {
 var action = args.Length == 1 ? args[0] : "";
 if (!new[] { "play", "pause", "next", "previous", "status" }.Contains(action)) { Reply(false, code:"unsupported_action"); return; }
 var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
 var spotify = manager.GetSessions().FirstOrDefault(s => Selection.IsSpotify(s.SourceAppUserModelId));
 if (spotify == null) { Reply(false, code:"spotify_unavailable"); return; }
 if (action != "status") {
  var accepted = action switch {
   "play" => await spotify.TryPlayAsync(), "pause" => await spotify.TryPauseAsync(),
   "next" => await spotify.TrySkipNextAsync(), "previous" => await spotify.TrySkipPreviousAsync(), _ => false
  };
  if (!accepted) { Reply(false, code:"unsupported_operation"); return; }
 }
 var info = spotify.GetPlaybackInfo(); var media = await spotify.TryGetMediaPropertiesAsync();
 Reply(true, new { title=media.Title, artist=media.Artist, playback=info.PlaybackStatus.ToString(), canPlay=info.Controls.IsPlayEnabled, canPause=info.Controls.IsPauseEnabled, canNext=info.Controls.IsNextEnabled, canPrevious=info.Controls.IsPreviousEnabled });
} catch { Reply(false, code:"media_session_error"); }
