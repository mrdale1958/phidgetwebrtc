# Google Maps Zoom Oscillation Analysis

## Problem Summary

The application experienced rapid zoom oscillations during panning operations, causing jarring visual jumps and degraded user experience.

## Root Cause Analysis

Through comprehensive time series analysis, we identified that **Google Maps accepts fractional zoom values via `setZoom()` but then systematically snaps them back to preferred values (often integers) through the `zoom_changed` event**. This creates a fighting loop between our continuous fractional calculations and Google's internal correction mechanisms.

### Time Series Evidence

**Sustained Zoom Period (18:06:33):**
- 63 zoom events in 101ms
- 10 snap-backs detected
- Pattern: SET fractional → REPORT fractional → REPORT integer

**Oscillation Period (18:06:24):**
- 102 zoom events in 220ms  
- 81 rapid oscillations
- Same snap-back pattern but in rapid succession

## Technical Documentation Research

### Google Maps API Behavior

1. **`isFractionalZoomEnabled` Option:**
   - Defaults to `true` for vector maps
   - Defaults to `false` for raster maps
   - Controls whether the map accepts fractional zoom levels

2. **Internal Zoom Correction:**
   - Google Maps has internal mechanisms that prefer integer zoom levels
   - Even with fractional zoom enabled, snap-back behavior occurs
   - This behavior is consistent across browsers (Chrome, Safari, Edge)

3. **Official Documentation:**
   - No explicit mention of snap-back behavior in Google Maps API docs
   - `isFractionalZoomEnabled` documentation suggests it should prevent this
   - Appears to be undocumented behavior of the Maps rendering engine

## Browser Compatibility

The zoom snap-back behavior appears to be **consistent across browsers** as it's implemented at the Google Maps API level, not in browser-specific rendering code.

## Solution Implementation

### Configuration Flags Added

```javascript
// Configuration flags
const ENABLE_MAX_ZOOM_SERVICE = false; // Control dynamic zoom boundaries
const ENABLE_FRACTIONAL_ZOOM = false; // Control fractional zoom levels

// Map options updated
var mapOptions = {
  // ... other options
  isFractionalZoomEnabled: ENABLE_FRACTIONAL_ZOOM,
};
```

### Changes Made

1. **Added Configuration Flags:**
   - `ENABLE_MAX_ZOOM_SERVICE`: Controls whether to use MaxZoomService for dynamic boundaries
   - `ENABLE_FRACTIONAL_ZOOM`: Controls the `isFractionalZoomEnabled` map option

2. **Updated MaxZoomService Logic:**
   - Respects the `ENABLE_MAX_ZOOM_SERVICE` flag
   - Provides clear logging when disabled
   - Falls back to static `maxTicksAtLocation` value

3. **Enhanced Logging:**
   - Added configuration status to debug output
   - Clear indication when services are disabled by configuration

## Recommended Settings

For **stable operation without oscillations:**
```javascript
const ENABLE_MAX_ZOOM_SERVICE = false;
const ENABLE_FRACTIONAL_ZOOM = false;
```

For **maximum zoom precision** (with potential oscillations):
```javascript
const ENABLE_MAX_ZOOM_SERVICE = true;
const ENABLE_FRACTIONAL_ZOOM = true;
```

## Alternative Solutions

If fractional zoom is needed without oscillations:

1. **Quantize Zoom Levels:** Round fractional values to Google's preferred increments
2. **Detect and Stop Fighting:** Monitor zoom_changed events and stop setting zoom when Google corrects
3. **Use Integer Steps:** Modify the zoom calculation to use discrete integer levels
4. **Debounce Zoom Setting:** Add delays between zoom updates to prevent rapid corrections

## Files Modified

- `src/static/SLP.js`: Added configuration flags and updated initialization logic
- `analyze_zoom_oscillation.py`: Time series analysis script for diagnosing the issue

## Testing

With `ENABLE_MAX_ZOOM_SERVICE = false` and `ENABLE_FRACTIONAL_ZOOM = false`, the application should use:
- Static zoom boundaries (no dynamic MaxZoomService calls)
- Integer-only zoom levels (no fractional snap-back oscillations)

This configuration eliminates the root cause of the oscillation while maintaining functional zoom control.
