import pandas as pd
import matplotlib.pyplot as plt
plt.ioff()
import numpy as np
from time import time
from multiprocessing import Pool
from scipy import interpolate
from math import sqrt,floor,ceil
from scipy import integrate


if __name__ == "__main__":
    start = time()
    filename = "output/capture_slopes.xls"  #filename for raw output
    df = pd.read_excel(filename) # import excel docuument

    df['date'] = pd.to_datetime(df['date']) # make date column to datetime objects
    df = df.sort_values(by=['date']) #sort all entries by date
    # df = df.set_index('date')

    plotno = 5 #select which plot number to use

    plot = df[df['nr'] == plotno] # select the data from plot 2

    n2o = plot['N2O_N_mug_m2h']*10000/1e9
    n2o_avg = n2o.rolling(window=2).mean()
    n2o_avg.iloc[0] = 0.

    timediff = plot["date"].diff()/ pd.Timedelta(hours=1)
    timediff.iloc[0] = 0.

    n2o_sum = n2o_avg*timediff
    n2o_int = n2o_sum.cumsum()

    fig, (ax1, ax2,ax3) = plt.subplots(nrows = 3, ncols = 1, sharex=True)

    ax1.plot(plot["date"],n2o_int)
    ax1.set_ylabel('Cumulative\nNO2 kg/ha')
    ax1.set_title('N2O Release plot '+ str(plotno))
    ax2.plot(plot["date"],n2o_sum,'.')
    ax3.plot(plot["date"], n2o,'.')
    ax3.set_xlabel("date")

    plt.gcf().autofmt_xdate()
    plt.show()