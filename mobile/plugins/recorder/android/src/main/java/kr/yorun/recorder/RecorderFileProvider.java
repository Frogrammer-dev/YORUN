package kr.yorun.recorder;

import androidx.core.content.FileProvider;

/** A separate provider avoids merging with the host app's general FileProvider. */
public final class RecorderFileProvider extends FileProvider {}
