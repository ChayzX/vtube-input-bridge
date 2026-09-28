if (Selection.IsSpotify("chrome.exe")) throw new Exception("Must not control Chrome");
if (Selection.IsSpotify("NotSpotify.exe")) throw new Exception("Must not match arbitrary names");
if (!Selection.IsSpotify("Spotify.exe")) throw new Exception("Desktop Spotify unavailable");
if (!Selection.IsSpotify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")) throw new Exception("Store Spotify unavailable");
Console.WriteLine("Spotify session selection: 4 checks passed");
