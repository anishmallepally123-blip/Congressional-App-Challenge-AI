"""
Weather connector: current weather and a forecast for any place, from Open-Meteo
(open-meteo.com), a free weather service that needs no account or key.

    python weather_server.py
"""

import os
import urllib.parse

from mcp_server import Server, ToolError, http_json

GEO_API = os.environ.get("WEATHER_GEO_API", "https://geocoding-api.open-meteo.com/v1/search")
FORECAST_API = os.environ.get("WEATHER_API", "https://api.open-meteo.com/v1/forecast")
server = Server("weather")

# WMO weather codes used by Open-Meteo.
CODES = {
    0: "clear sky", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers",
    81: "rain showers", 82: "heavy rain showers", 85: "snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
}


def find_place(place):
    name = place.split(",")[0].strip()
    data = http_json(f"{GEO_API}?{urllib.parse.urlencode({'name': name, 'count': 10})}", service="Open-Meteo")
    results = data.get("results") or []
    if not results:
        raise ToolError(f"Couldn't find a place called {place}.")
    # "Springfield, IL" -> prefer the result whose state or country matches the rest.
    rest = [p.strip().lower() for p in place.split(",")[1:] if p.strip()]
    for r in results:
        region = " ".join(str(r.get(k, "")) for k in ("admin1", "country", "country_code")).lower()
        if rest and all(p in region or (len(p) == 2 and p.upper() == str(r.get("admin1_code", "")).upper()) for p in rest):
            return r
    return results[0]


@server.tool("Check the weather", read_only=True,
             description="Get the current weather and the forecast for the next days for a city or town.",
             params={"place": ("string", "City or town, optionally with state or country, e.g. 'Austin, Texas'"),
                     "days": ("integer", "Days of forecast, 1 to 7 (default 3)"),
                     "units": ("string", "fahrenheit or celsius (default fahrenheit)", {"enum": ["fahrenheit", "celsius"]})},
             required=["place"])
def get_weather(place, days=3, units="fahrenheit"):
    loc = find_place(place)
    days = max(1, min(int(days or 3), 7))
    imperial = units != "celsius"
    query = {
        "latitude": loc["latitude"], "longitude": loc["longitude"], "timezone": "auto", "forecast_days": days,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        "temperature_unit": "fahrenheit" if imperial else "celsius",
        "wind_speed_unit": "mph" if imperial else "kmh",
    }
    data = http_json(f"{FORECAST_API}?{urllib.parse.urlencode(query)}", service="Open-Meteo")
    deg = "°F" if imperial else "°C"
    speed = "mph" if imperial else "km/h"
    where = ", ".join(str(loc[k]) for k in ("name", "admin1", "country") if loc.get(k))
    cur = data.get("current", {})
    lines = [f"Weather for {where}:",
             f"Now: {CODES.get(cur.get('weather_code'), 'unknown')}, {cur.get('temperature_2m')}{deg} "
             f"(feels like {cur.get('apparent_temperature')}{deg}), humidity {cur.get('relative_humidity_2m')}%, "
             f"wind {cur.get('wind_speed_10m')} {speed}"]
    daily = data.get("daily", {})
    for i, day in enumerate(daily.get("time", [])):
        lines.append(f"{day}: {CODES.get(daily['weather_code'][i], 'unknown')}, high {daily['temperature_2m_max'][i]}{deg}, "
                     f"low {daily['temperature_2m_min'][i]}{deg}, {daily['precipitation_probability_max'][i]}% chance of rain")
    return "\n".join(lines)


if __name__ == "__main__":
    server.run()
