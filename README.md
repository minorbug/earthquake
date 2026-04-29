# [Earthquake]

Earthquake is a personal project that I decided to create to brush up on newer web technologies. I was inspired by the "Earthquake" exhibit at the California Academy of Sciences in San Francisco, which included a live planetarium view of earthquake activity, from below the Earth's surface. I decided to use WebGL to create a similar view.

* Source: [https://github.com/minorbug/earthquake](https://github.com/minorbug/earthquake)
* Demo: [http://mattbaker.me/earthquake](http://mattbaker.me/earthquake)
* Twitter: [@nerdmattbaker](http://twitter.com/nerdmattbaker)


## Data Sources

- **Plate boundaries:** PB2002 (Bird, P. 2003. "An updated digital model of plate boundaries." *Geochemistry, Geophysics, Geosystems* 4(3): 1027. doi:10.1029/2001GC000252). Sourced from [fraxen/tectonicplates](https://github.com/fraxen/tectonicplates).
- **Active faults:** GEM Global Active Faults Database (Styron, R. & Pagani, M. 2020. "The GEM Global Active Faults Database." *Earthquake Spectra* 36(1_suppl): 160–180. doi:10.1177/8755293020944182). Sourced from [GEMScienceTools/gem-global-active-faults](https://github.com/GEMScienceTools/gem-global-active-faults). License: **CC-BY-SA 4.0** — derivatives (including this repository's `data/gem_active_faults_trimmed.geojson`) must be redistributed under the same license.
- **Land + countries:** Natural Earth public-domain vector data via [nvkelso/natural-earth-vector](https://github.com/nvkelso/natural-earth-vector).
- **Earthquake feed:** USGS Earthquake Hazards Program real-time GeoJSON feed.


## Quick start

Using Google Chrome (I hope to optimize for other browsers as well):

1. View the page at [http://mattbaker.me/earthquake](http://mattbaker.me/earthquake). This will show you all of the major (magnitude 4.5+) earthquakes measured in the past month by the USGS.
2. Use your mouse to move the camera around underneath the earth's crust (you can also use the "A" and "D" keys to rotate the camera if needed). Click on the quake markers to view depth and magnitude information.


## Credits / Libraries

* jQuery
* [jRumble](jackrugile.com/jrumble/)
* [Three.js](http://threejs.org)
* [Howler](https://github.com/goldfire/howler.js) - for future audio

## Contributing

Anyone and everyone is welcome to contribute. I intend to make optimizations in the future, and your help would be greatly appreciated.