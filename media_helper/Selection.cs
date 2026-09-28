public static class Selection {
 public static bool IsSpotify(string id) => id.Equals("Spotify.exe", System.StringComparison.OrdinalIgnoreCase) || id.Equals("Spotify", System.StringComparison.OrdinalIgnoreCase) || id.StartsWith("SpotifyAB.SpotifyMusic_", System.StringComparison.OrdinalIgnoreCase);
}
