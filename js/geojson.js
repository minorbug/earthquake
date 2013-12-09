/**
 * Created by mattbaker on 12/7/13.
 */

var GeoJSON = (function(){

    var earthquakes = [];

    return {
        loadEarthquakeData: function(time, magnitude){
            var url = 'http://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/'+time+'_'+magnitude+'.geojsonp';
            $.ajax({
                url:url,
                crossDomain:true,
                dataType: 'jsonp',
                jsonp: false,
                jsonpCallback: 'eqfeed_callback',
                beforeSend: function(){
                    $(document).trigger('getEarthquakeData_start', { message: 'Getting data from USGS ('+url+')' });
                },
                error: function(j,status,error){
                    $(document).trigger('getEarthquakeData_error', { message: 'Error data from USGS: '+error });
                },
                success: function(data,status,xhr){
                    var featuresArray = data.features;
                    for (var i= 0, l=featuresArray.length; i<l;i++){
                      earthquakes.push({
                          lng:featuresArray[i].geometry.coordinates[0],
                          lat:featuresArray[i].geometry.coordinates[1],
                          depth:featuresArray[i].geometry.coordinates[2],
                          magnitude:featuresArray[i].properties.mag,
                          title:featuresArray[i].properties.title
                      });
                    }
                    $(document).trigger('getEarthquakeData_success', { message: 'Earthquake data received successfully.', earthquakes:earthquakes });
                }
            });
        }
    };


})();