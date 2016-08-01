var app=angular.module('single-page-app',['ngRoute']);


app.config(function($routeProvider){


      $routeProvider
          .when('/',{
                templateUrl: 'inicio.html'
          })
          .when('/predicacion',{
                templateUrl: 'predicacion/index.html'
          });
          .when('/salidas',{
                templateUrl: 'predicacion/salidas.html'
          });
          .when('/territorios',{
                templateUrl: 'predicacion/territorios.html'
          });         
          .when('/informe',{
                templateUrl: 'predicacion/informe.html'
          });    
          .when('/reuniones',{
                templateUrl: 'reuniones/index.html'
          });
          .when('/vivo',{
                templateUrl: 'reuniones/vivo.html'
          }); 
          .when('/finde',{
                templateUrl: 'reuniones/finde.html'
          });           
          .when('/semana',{
                templateUrl: 'reuniones/semana.html'
          });
          .when('/programa',{
                templateUrl: 'reuniones/programa.html'
          });           
});


app.controller('cfgController',function($scope){

      $scope.message="Hello world";

});
