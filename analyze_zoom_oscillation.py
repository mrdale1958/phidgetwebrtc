import re
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
from datetime import datetime, timezone

# Read the console log
with open('/Users/dalemacdonald/LocalProjects/phidgetwebrtc/console.log', 'r') as f:
    lines = f.readlines()

# Parse zoom data
zoom_data = []
set_pattern = r'\[([^\]]+)\] ZOOM APPLIED: Set map zoom to ([\d.]+)'
reported_pattern = r'\[([^\]]+)\] 🗺️\s+MAPS API ZOOM_CHANGED EVENT: ([\d.]+)'

for line in lines:
    # Check for ZOOM APPLIED (values we set)
    set_match = re.search(set_pattern, line)
    if set_match:
        timestamp_str = set_match.group(1)
        zoom_value = float(set_match.group(2))
        # Parse timestamp
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        zoom_data.append({
            'timestamp': timestamp,
            'type': 'set',
            'value': zoom_value,
            'timestamp_ms': timestamp.timestamp() * 1000
        })
    
    # Check for MAPS API ZOOM_CHANGED (values Google reported)
    reported_match = re.search(reported_pattern, line)
    if reported_match:
        timestamp_str = reported_match.group(1)
        zoom_value = float(reported_match.group(2))
        # Parse timestamp
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        zoom_data.append({
            'timestamp': timestamp,
            'type': 'reported',
            'value': zoom_value,
            'timestamp_ms': timestamp.timestamp() * 1000
        })

# Sort by timestamp
zoom_data.sort(key=lambda x: x['timestamp'])

print(f"📊 ZOOM OSCILLATION ANALYSIS")
print(f"=" * 80)
print(f"Total zoom events found: {len(zoom_data)}")
print(f"Time range: {zoom_data[0]['timestamp']} to {zoom_data[-1]['timestamp']}")

# Separate set vs reported
set_events = [d for d in zoom_data if d['type'] == 'set']
reported_events = [d for d in zoom_data if d['type'] == 'reported']

print(f"Values we SET: {len(set_events)}")
print(f"Values Google REPORTED: {len(reported_events)}")
print()

# Focus on both the sustained zoom period AND the oscillation period
print("🔍 SUSTAINED ZOOM ANALYSIS (Beginning of session)")
print(f"-" * 60)

# Look at the sustained zoom period (around 18:06:33 - rapid zoom sequence)
sustained_start = datetime(2025, 7, 30, 18, 6, 33, 70000, tzinfo=timezone.utc)
sustained_end = datetime(2025, 7, 30, 18, 6, 33, 180000, tzinfo=timezone.utc)

sustained_data = [d for d in zoom_data if sustained_start <= d['timestamp'] <= sustained_end]

print(f"Events during sustained zoom period: {len(sustained_data)}")
print()

if sustained_data:
    print("SUSTAINED ZOOM TIME SERIES DATA:")
    print("Time(ms)    Type       Zoom Value    Δ from prev")
    print("-------------------------------------------------------")
    
    base_time = sustained_data[0]['timestamp']
    prev_value = None
    snap_backs_sustained = 0
    
    for i, event in enumerate(sustained_data[:50]):  # Show first 50 events
        relative_time = int((event['timestamp'] - base_time).total_seconds() * 1000)
        delta_str = ""
        if prev_value is not None:
            delta = event['value'] - prev_value
            delta_str = f"{delta:+.6f}"
            
            # Check for snap-back pattern in sustained zoom
            if abs(delta) > 0.001 and event['type'] == 'reported':
                # Look at the previous event
                if i > 0 and sustained_data[i-1]['type'] == 'set':
                    set_value = sustained_data[i-1]['value']
                    if abs(event['value'] - set_value) > 0.001:
                        snap_backs_sustained += 1
        
        type_emoji = "📤 SET" if event['type'] == 'set' else "📥 RPT"
        print(f"{relative_time:7d}ms  {type_emoji}  {event['value']:11.6f}  {delta_str:>11s}")
        prev_value = event['value']
    
    print(f"\n🚨 Snap-backs detected in SUSTAINED zoom period: {snap_backs_sustained}")

print("\n" + "="*80)

# Now analyze the oscillation period (around 18:06:24)
print("🔍 OSCILLATION PERIOD ANALYSIS (18:06:24.200 - 18:06:24.420)")
print(f"-" * 60)

oscillation_start = datetime(2025, 7, 30, 18, 6, 24, 200000, tzinfo=timezone.utc)
oscillation_end = datetime(2025, 7, 30, 18, 6, 24, 420000, tzinfo=timezone.utc)

oscillation_data = [d for d in zoom_data if oscillation_start <= d['timestamp'] <= oscillation_end]

print(f"🔍 OSCILLATION PERIOD ANALYSIS (18:06:24.200 - 18:06:24.420)")
print(f"-" * 60)
print(f"Events during oscillation: {len(oscillation_data)}")
print()

# Show the oscillation pattern
print("TIME SERIES DATA (showing the problematic oscillation):")
print("Time(ms)    Type       Zoom Value    Δ from prev")
print("-" * 55)

base_time = oscillation_data[0]['timestamp_ms'] if oscillation_data else 0
prev_value = None

for i, event in enumerate(oscillation_data[:30]):  # Show first 30 events
    relative_time = event['timestamp_ms'] - base_time
    delta_str = ""
    if prev_value is not None:
        delta = event['value'] - prev_value
        delta_str = f"{delta:+.6f}"
    
    type_symbol = "📤 SET" if event['type'] == 'set' else "📥 RPT"
    print(f"{relative_time:7.0f}ms  {type_symbol:<7} {event['value']:>12.6f}  {delta_str:>12}")
    prev_value = event['value']

print()

# Analyze the pattern
oscillations = 0
max_deviation = 0
fractional_to_integer_snaps = 0

for i in range(1, len(oscillation_data)):
    curr = oscillation_data[i]
    prev = oscillation_data[i-1]
    
    time_diff = curr['timestamp_ms'] - prev['timestamp_ms']
    value_diff = abs(curr['value'] - prev['value'])
    
    # Count rapid oscillations
    if time_diff < 10 and value_diff > 0.001:  # Within 10ms and significant change
        oscillations += 1
        max_deviation = max(max_deviation, value_diff)
    
    # Count fractional -> integer snaps
    if (prev['type'] == 'set' and curr['type'] == 'reported' and 
        prev['value'] != int(prev['value']) and curr['value'] == int(curr['value'])):
        fractional_to_integer_snaps += 1

print(f"🚨 OSCILLATION METRICS:")
print(f"Total rapid oscillations (< 10ms, > 0.001 zoom): {oscillations}")
print(f"Maximum zoom deviation: {max_deviation:.6f}")
print(f"Fractional → Integer snaps: {fractional_to_integer_snaps}")
print()

# Create visual plot
if len(oscillation_data) > 0:
    # Prepare data for plotting
    times = [(d['timestamp_ms'] - base_time) for d in oscillation_data]
    values = [d['value'] for d in oscillation_data]
    colors = ['red' if d['type'] == 'set' else 'blue' for d in oscillation_data]
    markers = ['o' if d['type'] == 'set' else 's' for d in oscillation_data]
    
    plt.figure(figsize=(15, 8))
    
    # Plot set values (red circles)
    set_times = [times[i] for i, d in enumerate(oscillation_data) if d['type'] == 'set']
    set_values = [values[i] for i, d in enumerate(oscillation_data) if d['type'] == 'set']
    
    # Plot reported values (blue squares)
    reported_times = [times[i] for i, d in enumerate(oscillation_data) if d['type'] == 'reported']
    reported_values = [values[i] for i, d in enumerate(oscillation_data) if d['type'] == 'reported']
    
    plt.scatter(set_times, set_values, c='red', marker='o', s=60, alpha=0.7, label='Values we SET', zorder=3)
    plt.scatter(reported_times, reported_values, c='blue', marker='s', s=40, alpha=0.7, label='Values Google REPORTED', zorder=2)
    
    # Connect the points to show the sequence
    plt.plot(times, values, 'gray', alpha=0.3, linewidth=1, zorder=1)
    
    plt.xlabel('Time (milliseconds from start of oscillation)')
    plt.ylabel('Zoom Level')
    plt.title('🔍 Zoom Oscillation Pattern: SET vs REPORTED Values\n(Showing the rapid back-and-forth between fractional and integer zoom levels)')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Add annotations for key patterns
    if len(set_values) > 0 and len(reported_values) > 0:
        plt.axhline(y=3.0, color='orange', linestyle='--', alpha=0.5, label='Integer level (3.0)')
        
    plt.tight_layout()
    plt.savefig('/Users/dalemacdonald/LocalProjects/phidgetwebrtc/zoom_oscillation_plot.png', dpi=300, bbox_inches='tight')
    print(f"📈 Plot saved as: zoom_oscillation_plot.png")
    print()

# Summary
print(f"🎯 DIAGNOSIS:")
print(f"The oscillation shows a clear pattern:")
print(f"1. We SET a fractional zoom level (e.g., 3.001953125)")
print(f"2. Google Maps REPORTS the same fractional level")
print(f"3. Then Google Maps REPORTS an integer level (3.0)")
print(f"4. This creates a rapid back-and-forth oscillation")
print()
print(f"❗ ROOT CAUSE: Google Maps IS internally snapping fractional zooms to integers,")
print(f"   but this happens AFTER accepting the fractional value, creating the oscillation.")

