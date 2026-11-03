using PeckList.Core.Configuration;

namespace PeckList.Core.Tests;

public sealed class LayeredSettingsTests
{
    private static FileAwareSecretSource Env(Dictionary<string, string> values, Dictionary<string, string>? files = null) =>
        new(name => values.GetValueOrDefault(name), path => files?[path] ?? throw new FileNotFoundException(path));

    [Fact]
    public void Encrypted_values_open_only_with_their_key()
    {
        var cipher = ConfigCipher.FromText(ConfigCipher.NewKeyText());
        var sealedValue = cipher.Encrypt("s3cret value");
        Assert.StartsWith(ConfigCipher.Prefix, sealedValue);
        Assert.DoesNotContain("s3cret", sealedValue);
        Assert.Equal("s3cret value", cipher.Decrypt(sealedValue, "X"));
        Assert.NotEqual(sealedValue, cipher.Encrypt("s3cret value"));

        var other = ConfigCipher.FromText(ConfigCipher.NewKeyText());
        Assert.Contains("does not open with this CONFIG_KEY", Assert.Throws<SettingsException>(() => other.Decrypt(sealedValue, "X")).Message);
        Assert.Contains("not a key", Assert.Throws<SettingsException>(() => ConfigCipher.FromText("short")).Message);
    }

    [Fact]
    public void The_environment_beats_the_config_file_which_beats_the_page()
    {
        var key = ConfigCipher.NewKeyText();
        var hidden = ConfigCipher.FromText(key).Encrypt("from the file, encrypted");
        var layers = LayeredSettings.FromEnvironment(
            Env(new() { ["CONFIG_FILE"] = "/run/pl.env", ["CONFIG_KEY"] = key, ["REGISTRATION"] = "open" }),
            new Dictionary<string, string> { ["REGISTRATION"] = "closed", ["PUBLIC_URL"] = "https://page.example", ["SNAPSHOT_KEEP"] = "3" },
            _ => $"# Punchlist\nREGISTRATION=invite\nexport PUBLIC_URL=\"https://file.example\"\nOIDC_POCKET_CLIENT_SECRET={hidden}\n");
        Assert.Equal(("open", SettingSource.Environment), layers.Explain("REGISTRATION"));
        Assert.Equal(("https://file.example", SettingSource.File), layers.Explain("PUBLIC_URL"));
        Assert.Equal(("3", SettingSource.Page), layers.Explain("SNAPSHOT_KEEP"));
        Assert.Equal(((string?)null, SettingSource.Default), layers.Explain("LOG_LEVEL"));
        Assert.Equal("from the file, encrypted", layers.Get("OIDC_POCKET_CLIENT_SECRET"));
    }

    [Fact]
    public void An_encrypted_value_needs_the_key_and_a_bad_file_says_where()
    {
        var hidden = ConfigCipher.FromText(ConfigCipher.NewKeyText()).Encrypt("x");
        var layers = LayeredSettings.FromEnvironment(Env(new() { ["ADMIN_PASSWORD"] = hidden }));
        Assert.Contains("ADMIN_PASSWORD is encrypted but CONFIG_KEY is not set",
            Assert.Throws<SettingsException>(() => layers.Get("ADMIN_PASSWORD")).Message);

        Assert.Contains("CONFIG_FILE: line 2 is not NAME=value", Assert.Throws<SettingsException>(() =>
            LayeredSettings.FromEnvironment(Env(new() { ["CONFIG_FILE"] = "f" }), readFile: _ => "A=1\njust words\n")).Message);
        Assert.Contains("CONFIG_FILE: cannot read", Assert.Throws<SettingsException>(() =>
            LayeredSettings.FromEnvironment(Env(new() { ["CONFIG_FILE"] = "missing" }), readFile: path => throw new IOException("gone"))).Message);
    }

    [Fact]
    public void The_catalog_grows_with_the_providers_named()
    {
        var layers = LayeredSettings.FromEnvironment(Env(new() { ["OIDC_PROVIDERS"] = "pocket, Home-SSO" }));
        var keys = SettingsCatalog.For(layers).Select(each => each.Key).ToList();
        Assert.Contains("OIDC_POCKET_CLIENT_SECRET", keys);
        Assert.Contains("OIDC_HOME_SSO_SESSION_HOURS", keys);
        Assert.Equal(SettingKind.Secret, SettingsCatalog.Find(layers, "OIDC_POCKET_CLIENT_SECRET")!.Kind);
        Assert.True(SettingsCatalog.Find(layers, "DB_PATH")!.EnvironmentOnly);
        Assert.Null(SettingsCatalog.Find(layers, "NOT_A_SETTING"));
    }
}
